# 건부추노

서로 아는 대학원생끼리 쓰는 **동의 기반** 실시간 위치 공유 웹앱입니다.

## 원칙
- 본인이 직접 ‘위치 공유 시작’을 누르고 동의 화면에서 확인해야만 공유됩니다.
- 공유 시간(30분 / 1시간 / 3시간 / 직접 끌 때까지)을 고르고, 시간이 끝나면 자동으로 꺼집니다.
- ‘공유 중지’, 창 닫기, 그룹 나가기 시 서버에서 위치가 즉시 삭제됩니다.
- 내 위치를 볼 수 있는 사람(같은 그룹원) 목록이 항상 화면에 보입니다.
- 위치는 서버 메모리에만 있고, 이동 기록은 저장하지 않습니다.
- 재접속해도 공유는 자동으로 다시 켜지지 않습니다.

## 사용법
1. 한 명이 이름 + 그룹 이름을 넣고 ‘그룹 만들기’ → 6자리 초대코드 생성
2. ‘코드 복사’로 초대 링크를 연구실 단톡방 등에 공유
3. 다른 사람은 링크를 열고 이름 입력 후 ‘참여하기’
4. 원하는 사람만 ‘위치 공유 시작’

## 로컬 실행
```bash
npm install
npm start   # http://localhost:3000
```

## 배포
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/yangwlee0328-droid/geonbu-location-share)

브라우저 위치 기능은 **HTTPS**에서만 동작합니다(localhost 제외).
Render, Railway, Fly.io 같은 Node 호스팅에 올리면 HTTPS가 자동으로 붙습니다.
- Build: `npm install` / Start: `npm start`
- WebSocket 지원 필요 (위 서비스는 모두 지원)

## 구조
- `server.js` — Express + Socket.IO. 그룹/멤버/위치를 메모리에 보관하고 같은 그룹에만 전달
- `public/index.html`, `public/app.js` — Leaflet(OpenStreetMap) 지도 + 공유 패널
