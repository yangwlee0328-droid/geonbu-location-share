const $ = (id) => document.getElementById(id);
const socket = io();
let myId = null, state = null, watchId = null, map = null, fitted = '';
const markers = new Map();

function store(k, v) { try { localStorage.setItem(k, v); } catch {} }
function load(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
function esc(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 1800);
}

/* ---------- 시작 화면 ---------- */
// mode: 'create' (새 그룹) | 'code' (코드 입력) | 'invited' (초대 링크로 들어옴)
let mode = 'create';
const inviteCode = (new URLSearchParams(location.search).get('g') || '').toUpperCase();
$('name').value = load('name');

function setMode(m) {
  mode = m;
  $('code').classList.toggle('hidden', m !== 'code');
  $('btnMain').textContent = m === 'create' ? '새 그룹 만들기' : '참여하기';
  $('btnSwitch').textContent = m === 'create' ? '초대 코드가 있어요' : '새 그룹 만들기';
  $('btnSwitch').classList.toggle('hidden', m === 'invited');
  $('invited').classList.toggle('hidden', m !== 'invited');
  $('err').textContent = '';
}
$('btnSwitch').onclick = () => setMode(mode === 'create' ? 'code' : 'create');

if (inviteCode) {
  socket.emit('peek', { code: inviteCode }, (r) => {
    if (r.error) { setMode('code'); $('code').value = inviteCode; $('err').textContent = '초대 링크가 만료됐어요. 코드를 다시 받아 주세요.'; return; }
    $('invited').textContent = `‘${r.name}’에 초대받았어요`;
    setMode('invited');
  });
}

$('btnMain').onclick = () => {
  const name = $('name').value.trim();
  if (!name) { $('err').textContent = '이름을 먼저 적어 주세요.'; $('name').focus(); return; }
  if (mode === 'create') socket.emit('create', { name }, entered);
  else socket.emit('join', { code: mode === 'invited' ? inviteCode : $('code').value, name }, entered);
};
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnMain').click(); });

function entered(res) {
  if (res.error) { $('err').textContent = res.error; return; }
  myId = res.id;
  store('name', $('name').value.trim());
  store('code', res.code);
  history.replaceState(null, '', '?g=' + res.code);
  $('join').classList.add('hidden');
  $('app').classList.remove('hidden');
  initMap();
}

/* ---------- 지도 ---------- */
function initMap() {
  if (map) return setTimeout(() => map.invalidateSize(), 50);
  map = L.map('map', { zoomControl: false }).setView([37.5408, 127.0794], 15); // 건국대 서울캠퍼스
  // 지도 이미지는 우리 서버(/tiles)를 거쳐 받음 → API 키 불필요, 지도 서버 문제 시 서버가 다른 지도로 자동 전환
  L.tileLayer('/tiles/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
}

/* ---------- 실시간 상태 ---------- */
socket.on('state', (s) => { state = s; render(); });
socket.on('expired', () => { stopWatch(); toast('공유 시간이 끝나 내 위치를 숨겼어요'); });
socket.on('disconnect', () => stopWatch());
socket.on('connect', () => {
  // 재연결 시 그룹에는 다시 들어가지만, 위치 공유는 자동으로 다시 켜지 않음
  if (myId && load('code')) socket.emit('join', { code: load('code'), name: load('name') }, (r) => { if (!r.error) myId = r.id; });
});

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? '방금' : `${Math.round(s / 60)}분 전`;
}
const hhmm = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });

function render() {
  if (!state) return;
  const me = state.members.find((m) => m.id === myId);
  const others = state.members.filter((m) => m.id !== myId);
  const on = !!me?.sharing;

  $('gName').textContent = `${state.group.name} · ${state.members.length}명`;
  $('myDot').classList.toggle('on', on);
  $('myStatus').textContent = on ? '내 위치 보여주는 중' : '내 위치 숨김';
  $('mySub').textContent = on
    ? (me.until ? `${hhmm(me.until)}에 자동으로 꺼져요` : '직접 끌 때까지 보여요')
    : '켜기 전에는 아무도 내 위치를 볼 수 없어요';
  $('btnToggle').textContent = on ? '그만 보여주기' : '내 위치 보여주기';
  $('btnToggle').classList.toggle('stop', on);

  $('whoLabel').textContent = others.length
    ? `그룹 친구 ${others.length}명 · ${on ? '지금 내 위치를 볼 수 있어요' : '내 위치를 켜면 볼 수 있어요'}`
    : '아직 친구가 없어요. 위의 ‘친구 초대’를 눌러 보세요';
  $('chips').innerHTML = others.map((m) => `
    <button class="chip" data-id="${m.id}" ${m.loc ? '' : 'disabled'}>
      <span class="dot ${m.loc ? 'on' : ''}"></span>${esc(m.name)}
      <span style="color:var(--muted);font-size:12px">${m.loc ? ago(m.loc.ts) : '숨김'}</span>
    </button>`).join('');
  $('chips').querySelectorAll('.chip').forEach((b) => b.onclick = () => {
    const m = state.members.find((x) => x.id === b.dataset.id);
    if (m?.loc) map.setView([m.loc.lat, m.loc.lng], 17);
  });

  // 지도 이름표
  const seen = new Set();
  for (const m of state.members) {
    if (!m.loc) continue;
    seen.add(m.id);
    const label = m.id === myId ? '나' : esc(m.name);
    const icon = L.divIcon({ className: '', html: `<span class="pin ${m.id === myId ? 'me' : ''}">${label}</span>`, iconSize: [0, 0] });
    let mk = markers.get(m.id);
    if (!mk) { mk = L.marker([m.loc.lat, m.loc.lng], { icon }).addTo(map); markers.set(m.id, mk); }
    else { mk.setLatLng([m.loc.lat, m.loc.lng]); mk.setIcon(icon); }
  }
  for (const [id, mk] of markers) if (!seen.has(id)) { mk.remove(); markers.delete(id); }
  // 새로 보이는 사람이 생기면 모두 보이게 지도 범위 맞춤 (아래 패널에 가리지 않게 여백)
  if (markers.size && [...markers.keys()].some((id) => !fitted.includes(id))) {
    fitted = [...markers.keys()].join(',');
    const sheetH = document.querySelector('.sheet').offsetHeight;
    map.fitBounds(L.featureGroup([...markers.values()]).getBounds(), { maxZoom: 17, paddingTopLeft: [40, 70], paddingBottomRight: [40, sheetH + 30] });
  }
}
setInterval(render, 30000);

/* ---------- 켜기 / 끄기 ---------- */
$('btnToggle').onclick = () => {
  const me = state?.members.find((m) => m.id === myId);
  if (me?.sharing) return stopSharing();
  if (!navigator.geolocation) return toast('이 브라우저는 위치 기능을 지원하지 않아요');
  const n = state.members.length - 1;
  $('pickInfo').textContent = `그룹 친구 ${n}명이 내 위치를 볼 수 있어요. 언제든 끌 수 있고, 끄면 바로 지워져요.`;
  $('pick').classList.remove('hidden');
};
$('pickCancel').onclick = () => $('pick').classList.add('hidden');
$('pick').onclick = (e) => { if (e.target.id === 'pick') $('pick').classList.add('hidden'); };
document.querySelectorAll('#pick .opt').forEach((b) => b.onclick = () => {
  $('pick').classList.add('hidden');
  socket.emit('sharing', { on: true, minutes: Number(b.dataset.min) });
  watchId = navigator.geolocation.watchPosition(
    (p) => socket.emit('loc', { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
    (e) => {
      stopSharing();
      toast(e.code === 1 ? '휴대폰 설정에서 위치 권한을 허용해 주세요' : '위치를 찾지 못했어요. 잠시 후 다시 해 주세요');
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
  );
});

function stopWatch() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; }
function stopSharing() { stopWatch(); socket.emit('sharing', { on: false }); }

/* ---------- 초대 / 나가기 ---------- */
$('btnInvite').onclick = async () => {
  const url = `${location.origin}/?g=${state.group.code}`;
  const text = `‘${state.group.name}’ 위치 공유 그룹에 초대해요`;
  if (navigator.share) { try { await navigator.share({ title: '건부추노', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('초대 링크를 복사했어요. 단톡방에 붙여넣으세요'); }
  catch { prompt('이 링크를 친구에게 보내세요', url); }
};
$('btnLeave').onclick = () => {
  if (!confirm('그룹에서 나갈까요? 내 위치도 바로 지워져요.')) return;
  stopSharing();
  socket.emit('leave');
  store('code', '');
  myId = null; state = null; fitted = '';
  for (const mk of markers.values()) mk.remove();
  markers.clear();
  history.replaceState(null, '', '/');
  setMode('create');
  $('app').classList.add('hidden');
  $('join').classList.remove('hidden');
};
