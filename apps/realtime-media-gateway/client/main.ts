// walking skeleton 클라이언트. 이후 단계에서 apps/web으로 옮긴다.
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
let myPeerId = "";

/**
 * SFU 시그널링은 요청/응답 성격이 강해 id 상관관계가 필요하다.
 *
 * 응답 payload는 아직 검증하지 않는다. 호출부가 기대하는 모양을 타입 인자로 선언하며,
 * 그 모양이 곧 계약 패키지에서 스키마로 고정해야 할 대상이다.
 */
function request<T = unknown>(method: string, data: unknown = {}): Promise<T> {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    socket.send(JSON.stringify({ id, method, data }));
  });
}

const device = new Device();
let sendTransport: types.Transport | undefined;
let recvTransport: types.Transport | undefined;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  if (message.id !== undefined) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (!entry) return;

    if (message.ok) {
      entry.resolve(message.data);
    } else {
      entry.reject(new Error(message.error));
    }

    return;
  }

  if (message.method === "welcome") {
    myPeerId = message.data.peerId;
    log(`접속됨 — 내 peerId: ${myPeerId}`);
    return;
  }

  if (message.method === "newProducer") {
    log(`새 producer 감지: ${message.data.peerId}`);
    void consume(message.data.producerId, message.data.peerId);
    return;
  }

  if (message.method === "peerClosed") {
    log(`참가자 퇴장: ${message.data.peerId}`);
    document.getElementById(`audio-${message.data.peerId}`)?.remove();
  }
});

async function start() {
  const routerRtpCapabilities = await request<types.RtpCapabilities>("getRouterRtpCapabilities");
  await device.load({ routerRtpCapabilities });
  await request("setRtpCapabilities", { rtpCapabilities: device.rtpCapabilities });
  log("device 로드 완료");

  sendTransport = device.createSendTransport(
    await request<types.TransportOptions>("createWebRtcTransport"),
  );
  wireTransport(sendTransport);
  sendTransport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
    request<{ id: string }>("produce", { transportId: sendTransport!.id, kind, rtpParameters })
      .then(({ id }) => callback({ id }))
      .catch(errback);
  });

  recvTransport = device.createRecvTransport(
    await request<types.TransportOptions>("createWebRtcTransport"),
  );
  wireTransport(recvTransport);

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const [track] = stream.getAudioTracks();

  if (track === undefined) {
    throw new Error("마이크 오디오 트랙을 얻지 못했습니다.");
  }

  await sendTransport.produce({ track });
  log("내 오디오 송출 시작");

  // 내가 들어오기 전부터 있던 참가자들을 받아온다.
  const existing = await request<{ producerId: string; peerId: string }[]>("listProducers");

  for (const { producerId, peerId } of existing) {
    await consume(producerId, peerId);
  }
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

  const parameters = await request<types.ConsumerOptions>("consume", {
    transportId: recvTransport.id,
    producerId,
  });
  const consumer = await recvTransport.consume(parameters);
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
