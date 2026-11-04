// 동의 기반 실시간 위치 공유 서버
// - 위치는 메모리에만 저장 (DB 저장 없음, 서버 재시작 시 사라짐)
// - 공유를 끄거나 접속을 끊으면 즉시 삭제
// - 같은 그룹(초대코드) 멤버에게만 전달
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const STALE_MS = 10 * 60 * 1000; // 10분 동안 갱신 없으면 위치 숨김

const app = express();
app.use(express.static(__dirname + '/public'));
app.use('/vendor/leaflet', express.static(__dirname + '/node_modules/leaflet/dist'));
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server);

// groups: code -> { name, members: Map<socketId, member> }
// member: { id, name, sharing, until, loc: {lat, lng, acc, ts} | null }
const groups = new Map();

function newCode() {
  let code;
  do {
    code = crypto.randomBytes(4).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
  } while (code.length < 6 || groups.has(code));
  return code;
}

function publicMember(m) {
  const fresh = m.loc && Date.now() - m.loc.ts < STALE_MS;
  return {
    id: m.id,
    name: m.name,
    sharing: m.sharing,
    until: m.until,
    loc: m.sharing && fresh ? m.loc : null,
  };
}

function broadcast(code) {
  const g = groups.get(code);
  if (!g) return;
  io.to(code).emit('state', {
    group: { code, name: g.name },
    members: [...g.members.values()].map(publicMember),
  });
}

function clean(s) {
  return String(s || '').trim().slice(0, 30);
}

io.on('connection', (socket) => {
  let code = null;

  socket.on('create', ({ groupName, name }, ack) => {
    const c = newCode();
    groups.set(c, { name: clean(groupName) || (clean(name) ? `${clean(name)}의 그룹` : '우리 그룹'), members: new Map() });
    join(c, name, ack);
  });

  // 초대 링크로 들어왔을 때 그룹 이름 미리 보여주기
  socket.on('peek', ({ code: c }, ack) => {
    const g = groups.get(clean(c).toUpperCase());
    ack && ack(g ? { name: g.name, count: g.members.size } : { error: true });
  });

  socket.on('join', ({ code: c, name }, ack) => {
    c = clean(c).toUpperCase();
    if (!groups.has(c)) return ack && ack({ error: '없는 초대코드입니다.' });
    join(c, name, ack);
  });

  function join(c, name, ack) {
    name = clean(name);
    if (!name) return ack && ack({ error: '이름을 입력하세요.' });
    leave();
    code = c;
    socket.join(c);
    groups.get(c).members.set(socket.id, { id: socket.id, name, sharing: false, until: null, loc: null });
    ack && ack({ ok: true, code: c, id: socket.id });
    broadcast(c);
  }

  socket.on('sharing', ({ on, minutes }) => {
    const m = me();
    if (!m) return;
    m.sharing = !!on;
    m.until = on && minutes > 0 ? Date.now() + Math.min(minutes, 24 * 60) * 60000 : null;
    if (!on) m.loc = null; // 끄면 위치 즉시 삭제
    broadcast(code);
  });

  socket.on('loc', ({ lat, lng, acc }) => {
    const m = me();
    if (!m || !m.sharing) return; // 동의(공유 켬) 없이 보낸 위치는 무시
    if (![lat, lng].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    m.loc = { lat, lng, acc: Number.isFinite(acc) ? Math.round(acc) : null, ts: Date.now() };
    broadcast(code);
  });

  socket.on('leave', leave);
  socket.on('disconnect', leave);

  function me() {
    return code && groups.get(code)?.members.get(socket.id);
  }

  function leave() {
    if (!code) return;
    const g = groups.get(code);
    socket.leave(code);
    if (g) {
      g.members.delete(socket.id);
      if (g.members.size === 0) {
        // 빈 그룹은 1시간 뒤 삭제
        const c = code;
        setTimeout(() => {
          const gg = groups.get(c);
          if (gg && gg.members.size === 0) groups.delete(c);
        }, 60 * 60 * 1000).unref();
      }
      broadcast(code);
    }
    code = null;
  }
});

// 공유 시간 만료 처리
setInterval(() => {
  const now = Date.now();
  for (const [c, g] of groups) {
    let changed = false;
    for (const m of g.members.values()) {
      if (m.sharing && m.until && now > m.until) {
        m.sharing = false;
        m.until = null;
        m.loc = null;
        changed = true;
        io.to(m.id).emit('expired');
      }
    }
    if (changed) broadcast(c);
  }
}, 15000).unref();

server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
