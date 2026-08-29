# Realtime Media Gateway Agent Context

이 앱은 mediasoup SFU worker와 그 제어용 WebSocket 시그널링을 소유한다.

- 경계는 "음성"이 아니라 **미디어 도메인**이다. 영상·화면 공유·녹음이 이 앱 안으로 들어온다.
  음성 전용 이름과 구조를 새로 만들지 않는다.
- 미디어는 mediasoup worker(별도 C++ 프로세스)와 브라우저가 직접 주고받는다. Node는 제어만 하며
  **오디오 경로에 있지 않다.** 협상이 끝난 뒤 이 프로세스가 죽어도 진행 중인 통화는 유지된다.
- RTP·DTLS·ICE 파라미터는 해석하지 않고 mediasoup에 그대로 넘긴다. 검증은 mediasoup이 한다.
- 클라이언트가 보낸 프레임은 `@wake-surfer/realtime-media-contracts`로 검증한 뒤에만 처리한다.
  **새 method를 추가할 때는 계약을 먼저 갱신한다.** 응답할 `id`가 있으면 해당 요청만 실패로
  돌려주고, 봉투가 깨져 응답할 대상이 없을 때만 연결을 닫는다.
- 참가자 상태는 WebSocket 연결이 사는 동안만 존재하는 메모리 Map이며 **단일 인스턴스를 전제한다.**
  스케일아웃 시 이 registry만 교체하도록 경계를 유지한다.
- `announcedAddress`에 loopback 주소를 쓰지 않는다. 루프백을 주면 브라우저가 relay 후보를 만들지
  않으면서 **에러도 발생시키지 않아** 원인 추적이 매우 어렵다. 기본값은 LAN 주소 탐지다.
- **이 앱의 스크립트는 `pnpm run` 대신 직접 호출한다**(`node scripts/build-worker.mjs`). 실행 전
  의존성 검사가 재설치를 유발하면 빌드해둔 worker 바이너리와 헤더 패치가 지워진다.
- **workspace `allowBuilds`에서 mediasoup은 `false`다.** 허용하면 postinstall의 worker 컴파일이
  실패하는 환경에서 install 전체가 죽고, 그 install을 부르는 `pnpm lint`·`pnpm format`까지 같이
  멈춘다. 바이너리는 로컬에서 `scripts/build-worker.mjs`가, 배포에서는 Dockerfile의 worker
  스테이지가 각각 따로 만든다.
- mediasoup은 **3.19.17에 고정**한다. 3.19.18부터 C++20 `std::ranges`를 요구하는데 macOS 12의
  상한인 Apple clang 14에는 없다. 올리려면 Linux 또는 최신 툴체인이 먼저 필요하다.
- `scripts/build-worker.mjs`의 우회(헤더 include 주입, `SSL_CERT_FILE` 지정)는 upstream 문제
  때문이다. Linux에서는 불필요하므로 환경이 바뀌면 함께 걷어낸다.
- **브라우저 코드는 이 앱이 소유하지 않는다.** 통화 UI와 mediasoup-client 사용은
  `apps/web/src/features/voice/`에 있다. 여기서 정적 파일을 서빙하지 않으며, HTTP 서버는
  WebSocket이 얹힐 자리와 `/health` 확인 창구로만 쓴다.
- 방 하나가 Router 하나를 갖는다. Router는 자기 안의 producer끼리만 연결할 수 있는 경계이므로,
  **방 격리는 Router 분리로 얻는다.** 방은 첫 참가 때 만들고 마지막 참가자가 나갈 때 닫는다.
- `join` 이전에는 어떤 미디어 요청도 받지 않는다(`not_joined`). 실패 사유는 사람이 읽는 문구가 아니라
  계약의 코드로 알린다.
- 아직 없는 것: 인증, 재연결 내성, 녹음. 새로 추가할 때 이 목록을 갱신한다.
