# Realtime Media Gateway Agent Context

이 앱은 mediasoup SFU worker와 그 제어용 WebSocket 시그널링을 소유한다.

- 경계는 "음성"이 아니라 **미디어 도메인**이다. 영상·화면 공유·녹음이 이 앱 안으로 들어온다.
  음성 전용 이름과 구조를 새로 만들지 않는다.
- 미디어는 mediasoup worker(별도 C++ 프로세스)와 브라우저가 직접 주고받는다. Node는 제어만 하며
  **오디오 경로에 있지 않다.** 협상이 끝난 뒤 이 프로세스가 죽어도 진행 중인 통화는 유지된다.
- RTP·DTLS·ICE 파라미터는 해석하지 않고 mediasoup에 그대로 넘긴다. 검증은 mediasoup이 한다.
- 참가자 상태는 WebSocket 연결이 사는 동안만 존재하는 메모리 Map이며 **단일 인스턴스를 전제한다.**
  스케일아웃 시 이 registry만 교체하도록 경계를 유지한다.
- `announcedAddress`에 loopback 주소를 쓰지 않는다. 루프백을 주면 브라우저가 relay 후보를 만들지
  않으면서 **에러도 발생시키지 않아** 원인 추적이 매우 어렵다. 기본값은 LAN 주소 탐지다.
- **`pnpm run <script>`를 쓰지 않는다.** 실행 전 의존성 검사가 재설치를 유발해 빌드해둔 worker
  바이너리와 헤더 패치를 지운다. `node scripts/build-worker.mjs`처럼 직접 호출한다.
- mediasoup은 **3.19.17에 고정**한다. 3.19.18부터 C++20 `std::ranges`를 요구하는데 macOS 12의
  상한인 Apple clang 14에는 없다. 올리려면 Linux 또는 최신 툴체인이 먼저 필요하다.
- `scripts/build-worker.mjs`의 우회(헤더 include 주입, `SSL_CERT_FILE` 지정)는 upstream 문제
  때문이다. Linux에서는 불필요하므로 환경이 바뀌면 함께 걷어낸다.
- 브라우저 코드(`client/`)와 확인용 페이지(`public/`)는 임시다. 클라이언트가 `apps/web`으로
  옮겨가면 정적 서버와 함께 제거한다.
- 아직 없는 것: 인증, 여러 방, 정원 제한, 재연결 내성, 녹음. 새로 추가할 때 이 목록을 갱신한다.
