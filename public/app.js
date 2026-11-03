const $ = (id) => document.getElementById(id);
const socket = io();
let myId = null, state = null, watchId = null, map = null, fitted = false;
const markers = new Map();

function store(k, v) { try { localStorage.setItem(k, v); } catch {} }
function load(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }

$('name').value = load('name');
const urlCode = new URLSearchParams(location.search).get('g');
$('code').value = urlCode || load('code');

function showErr(e) { $('err').textContent = e || ''; }
function entered(res) {
  if (res.error) return showErr(res.error);
  myId = res.id;
  store('name', $('name').value.trim());
  store('code', res.code);
  history.replaceState(null, '', '?g=' + res.code);
  $('join').classList.add('hidden');
  $('app').classList.remove('hidden');
  initMap();
}
$('btnJoin').onclick = () => socket.emit('join', { code: $('code').value, name: $('name').value }, entered);
$('btnCreate').onclick = () => socket.emit('create', { groupName: $('gname').value, name: $('name').value }, entered);

function initMap() {
  if (map) return setTimeout(() => map.invalidateSize(), 50);
  map = L.map('map').setView([37.5408, 127.0794], 15); // 건국대 서울캠퍼스 근처
  // CARTO 지도를 기본으로 쓰고, 안 불러와지면 OpenStreetMap으로 전환
  const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, subdomains: 'abcd', attribution: '&copy; OpenStreetMap &copy; CARTO',
  }).addTo(map);
  let errs = 0;
  carto.on('tileerror', () => {
    if (++errs !== 5) return;
    map.removeLayer(carto);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  });
}

socket.on('state', (s) => { state = s; render(); });
socket.on('expired', () => { stopWatch(); alert('공유 시간이 끝나 위치 공유가 자동으로 꺼졌어요.'); });
socket.on('disconnect', () => stopWatch());
socket.on('connect', () => {
  // 재연결 시 자동으로 다시 참여하지만, 위치 공유는 다시 켜야 함 (자동 재공유 안 함)
  if (myId && load('code')) socket.emit('join', { code: load('code'), name: load('name') }, (r) => { if (!r.error) myId = r.id; });
});

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? `${s}초 전` : `${Math.round(s / 60)}분 전`;
}
function esc(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function render() {
  if (!state) return;
  $('gTitle').textContent = state.group.name;
  $('gCode').textContent = state.group.code;
  const me = state.members.find((m) => m.id === myId);
  const on = !!me?.sharing;
  $('shareBox').classList.toggle('on', on);
  $('shareStatus').textContent = on ? '내 위치: 공유 중' : '내 위치: 공유 안 함';
  $('shareOn').classList.toggle('hidden', !on);
  $('shareOff').classList.toggle('hidden', on);
  $('untilText').textContent = on ? (me.until ? `${new Date(me.until).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}에 자동 종료` : '직접 끌 때까지 공유') : '';

  $('list').innerHTML = state.members.map((m) => `
    <div class="m">
      <span class="dot ${m.sharing ? 'on' : ''}"></span>
      <div class="name">${esc(m.name)}${m.id === myId ? ' (나)' : ''}
        <div class="meta">${m.sharing ? (m.loc ? `공유 중 · ${ago(m.loc.ts)}${m.loc.acc ? ` · ±${m.loc.acc}m` : ''}` : '공유 중 · 위치 확인 중') : '공유 안 함'}</div>
      </div>
      ${m.loc ? `<button class="ghost" data-id="${m.id}">보기</button>` : ''}
    </div>`).join('');
  $('list').querySelectorAll('button[data-id]').forEach((b) => b.onclick = () => {
    const m = state.members.find((x) => x.id === b.dataset.id);
    if (m?.loc) map.setView([m.loc.lat, m.loc.lng], 17);
  });

  // 마커 갱신
  const seen = new Set();
  for (const m of state.members) {
    if (!m.loc) continue;
    seen.add(m.id);
    const icon = L.divIcon({ className: '', html: `<span class="pin ${m.id === myId ? 'me' : ''}">${esc(m.name)}</span>`, iconAnchor: [20, 12] });
    let mk = markers.get(m.id);
    if (!mk) { mk = L.marker([m.loc.lat, m.loc.lng], { icon }).addTo(map); markers.set(m.id, mk); }
    else { mk.setLatLng([m.loc.lat, m.loc.lng]); mk.setIcon(icon); }
  }
  for (const [id, mk] of markers) if (!seen.has(id)) { mk.remove(); markers.delete(id); }
  // 새로 공유를 시작한 사람이 생기면 모두 보이도록 지도 범위를 다시 맞춤
  const key = [...markers.keys()].sort().join(',');
  if (markers.size && [...markers.keys()].some((id) => !(fitted || '').includes(id))) {
    fitted = key;
    map.fitBounds(L.featureGroup([...markers.values()]).getBounds().pad(0.3), { maxZoom: 17 });
  }
}
setInterval(render, 30000); // "n분 전" 갱신

// 동의 → 공유 시작
$('btnOn').onclick = () => {
  if (!navigator.geolocation) return alert('이 브라우저는 위치 기능을 지원하지 않아요.');
  $('cGroup').textContent = state.group.name;
  $('cCount').textContent = Math.max(state.members.length - 1, 0);
  $('cDur').textContent = $('dur').selectedOptions[0].textContent;
  $('consent').classList.remove('hidden');
};
$('cNo').onclick = () => $('consent').classList.add('hidden');
$('cYes').onclick = () => {
  $('consent').classList.add('hidden');
  const minutes = Number($('dur').value);
  socket.emit('sharing', { on: true, minutes });
  watchId = navigator.geolocation.watchPosition(
    (p) => socket.emit('loc', { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
    (e) => { alert('위치를 가져올 수 없어요: ' + e.message); stopSharing(); },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
  );
};

function stopWatch() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; }
function stopSharing() { stopWatch(); socket.emit('sharing', { on: false }); }
$('btnOff').onclick = stopSharing;

$('btnCopy').onclick = async () => {
  const link = `${location.origin}/?g=${state.group.code}`;
  try { await navigator.clipboard.writeText(link); $('btnCopy').textContent = '복사됨!'; }
  catch { prompt('초대 링크', link); }
  setTimeout(() => ($('btnCopy').textContent = '코드 복사'), 1500);
};
$('btnLeave').onclick = () => {
  stopSharing();
  socket.emit('leave');
  store('code', '');
  myId = null; state = null; fitted = false;
  for (const mk of markers.values()) mk.remove();
  markers.clear();
  history.replaceState(null, '', '/');
  $('app').classList.add('hidden');
  $('join').classList.remove('hidden');
};
