// walking skeleton 클라이언트. 이후 단계에서 apps/web으로 옮긴다.
import {
  ResponseFrameSchema,
  parseMediaNotification,
  type ConsumerDescriptor,
  type JoinResult,
  type MediaMethod,
  type ProduceResult,
  type ProducerDescriptor,
  type WebRtcTransportDescriptor,
} from "@wake-surfer/realtime-media-contracts";
import { Device } from "mediasoup-client";
import type { types } from "mediasoup-client";

const log = (message: string) => {
  const line = document.createElement("div");
  line.textContent = message;
  document.getElementById("log")!.prepend(line);
  console.log(message);
};

const socket = new WebSocket(`ws://${location.host}`);
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let requestId = 0;

/**
 * SFU 시그널링은 요청/응답 성격이 강해 id 상관관계가 필요하다.
 *
 * 응답 payload의 형태는 계약이 타입으로만 규정하고 런타임 검증은 하지 않는다. 게이트웨이가
 * 보내는 값이며, 그걸 못 믿는 상황이라면 검증으로 해결될 문제가 아니다.
 */
function request<T = unknown>(method: MediaMethod, data: unknown = {}): Promise<T> {
  const id = ++requestId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    socket.send(JSON.stringify({ id, method, data }));
  });
}

const device = new Device();
let sendTransport: types.Transport | undefined;
let recvTransport: types.Transport | undefined;

socket.addEventListener("message", (event) => {
  const message: unknown = JSON.parse(event.data);
  const response = ResponseFrameSchema.safeParse(message);

  if (response.success) {
    const entry = pending.get(response.data.id);
    pending.delete(response.data.id);

    if (!entry) return;

    if (response.data.ok) {
      entry.resolve(response.data.data);
    } else {
      entry.reject(new Error(response.data.error));
    }

    return;
  }

  handleNotification(message);
});

function handleNotification(message: unknown): void {
  if (typeof message !== "object" || message === null || !("method" in message)) return;

  const { method, data } = message as { method: unknown; data: unknown };
  if (typeof method !== "string") return;

  const notification = parseMediaNotification(method, data);
  if (notification === undefined) return;

  switch (notification.method) {
    case "welcome":
      log(`접속됨 — 내 peerId: ${notification.data.peerId}`);
      return;

    case "newProducer":
      log(`새 producer 감지: ${notification.data.peerId}`);
      void consume(notification.data.producerId, notification.data.peerId);
      return;

    case "peerClosed":
      log(`참가자 퇴장: ${notification.data.peerId}`);
      document.getElementById(`audio-${notification.data.peerId}`)?.remove();
  }
}

/** 방은 URL로 고른다. 인증이 붙으면 여기서 권한 검사를 거치게 된다. */
const roomId = new URLSearchParams(location.search).get("room") ?? "general";

async function start() {
  const joined = await request<JoinResult>("join", { roomId });
  log(`방 참가: ${joined.roomId} (현재 ${joined.peerCount}명)`);

  await device.load({
    routerRtpCapabilities: joined.routerRtpCapabilities as types.RtpCapabilities,
  });
  await request("setRtpCapabilities", { rtpCapabilities: device.rtpCapabilities });
  log("device 로드 완료");

  sendTransport = device.createSendTransport(await createTransport());
  wireTransport(sendTransport);
  sendTransport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
    request<ProduceResult>("produce", { transportId: sendTransport!.id, kind, rtpParameters })
      .then(({ id }) => callback({ id }))
      .catch(errback);
  });

  recvTransport = device.createRecvTransport(await createTransport());
  wireTransport(recvTransport);

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const [track] = stream.getAudioTracks();

  if (track === undefined) {
    throw new Error("마이크 오디오 트랙을 얻지 못했습니다.");
  }

  await sendTransport.produce({ track });
  log("내 오디오 송출 시작");

  // 내가 들어오기 전부터 있던 참가자들을 받아온다.
  const existing = await request<ProducerDescriptor[]>("listProducers");

  for (const { producerId, peerId } of existing) {
    await consume(producerId, peerId);
  }
}

/**
 * 게이트웨이는 mediasoup 구조를 그대로 돌려주므로 mediasoup-client 타입으로 단언한다.
 * 계약이 형태를 규정하지 않는 쪽이 의도된 설계다.
 */
async function createTransport(): Promise<types.TransportOptions> {
  const descriptor = await request<WebRtcTransportDescriptor>("createWebRtcTransport");
  return descriptor as unknown as types.TransportOptions;
}

function wireTransport(transport: types.Transport) {
  transport.on("connect", ({ dtlsParameters }, callback, errback) => {
    request("connectTransport", { transportId: transport.id, dtlsParameters })
      .then(() => callback())
      .catch(errback);
  });
  transport.on("connectionstatechange", (state) =>
    log(`${transport.direction} transport: ${state}`),
  );
}

async function consume(producerId: string, peerId: string) {
  if (!recvTransport) return;

  const descriptor = await request<ConsumerDescriptor>("consume", {
    transportId: recvTransport.id,
    producerId,
  });
  const consumer = await recvTransport.consume(descriptor as unknown as types.ConsumerOptions);
  await request("resumeConsumer", { consumerId: consumer.id });

  const element = document.createElement("audio");
  element.id = `audio-${peerId}`;
  element.autoplay = true;
  element.srcObject = new MediaStream([consumer.track]);
  document.getElementById("audios")!.append(element);
  log(`수신 시작: ${peerId}`);
}

document.getElementById("join")!.addEventListener("click", () => {
  (document.getElementById("join") as HTMLButtonElement).disabled = true;
  start().catch((error: unknown) => log(`실패: ${String(error)}`));
});

socket.addEventListener("open", () => log("WebSocket 연결됨. 통화 참가 버튼을 누르세요."));
