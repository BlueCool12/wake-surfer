import {
  ResponseFrameSchema,
  parseMediaNotification,
  type ConsumerDescriptor,
  type JoinResult,
  type MediaErrorCode,
  type MediaMethod,
  type ProduceResult,
  type ProducerDescriptor,
  type WebRtcTransportDescriptor,
} from "@wake-surfer/realtime-media-contracts";
import type { types } from "mediasoup-client";

export type VoiceCallStatus = "idle" | "joining" | "connected" | "failed";

/** 통화 중인 상대 한 명. `stream`을 `<audio>`에 물리면 소리가 난다. */
export type VoiceParticipant = {
  peerId: string;
  stream: MediaStream;
};

export type VoiceCallSnapshot = {
  status: VoiceCallStatus;
  participants: VoiceParticipant[];
  isMuted: boolean;
  error: string | undefined;
};

export type VoiceCallModel = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => VoiceCallSnapshot;
  join: () => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
};

const ERROR_MESSAGES: Record<MediaErrorCode, string> = {
  already_joined: "이미 통화에 참가해 있습니다.",
  internal: "통화 서버에서 오류가 발생했습니다.",
  invalid_payload: "통화 요청이 올바르지 않습니다.",
  not_found: "통화 대상을 찾을 수 없습니다.",
  not_joined: "통화에 참가하지 않은 상태입니다.",
  room_full: "통화 정원이 찼습니다.",
  unknown_method: "지원하지 않는 통화 요청입니다.",
};

const IDLE_SNAPSHOT: VoiceCallSnapshot = {
  status: "idle",
  participants: [],
  isMuted: false,
  error: undefined,
};

export function createVoiceCallModel(options: {
  gatewayUrl: string;
  roomId: string;
}): VoiceCallModel {
  const listeners = new Set<() => void>();
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (e: Error) => void }
  >();
  const consumersByPeerId = new Map<string, types.Consumer>();

  let snapshot: VoiceCallSnapshot = IDLE_SNAPSHOT;
  let socket: WebSocket | undefined;
  let device: types.Device | undefined;
  let sendTransport: types.Transport | undefined;
  let recvTransport: types.Transport | undefined;
  let localStream: MediaStream | undefined;
  let requestId = 0;

  function emit(next: Partial<VoiceCallSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  }

  /**
   * 응답 payload는 런타임 검증하지 않는다. 게이트웨이가 보내는 값이며, 그걸 못 믿는 상황이라면
   * 검증으로 해결될 문제가 아니다. 호출부가 기대하는 모양을 타입 인자로 선언한다.
   */
  function request<T = unknown>(method: MediaMethod, data: unknown = {}): Promise<T> {
    const id = ++requestId;

    return new Promise<T>((resolve, reject) => {
      if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
        reject(new Error("통화 서버와 연결되어 있지 않습니다."));
        return;
      }

      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      socket.send(JSON.stringify({ id, method, data }));
    });
  }

  function handleMessage(raw: string): void {
    const message: unknown = JSON.parse(raw);
    const response = ResponseFrameSchema.safeParse(message);

    if (response.success) {
      const entry = pending.get(response.data.id);
      pending.delete(response.data.id);

      if (entry === undefined) return;

      if (response.data.ok) {
        entry.resolve(response.data.data);
      } else {
        entry.reject(new Error(ERROR_MESSAGES[response.data.code] ?? response.data.error));
      }

      return;
    }

    if (typeof message !== "object" || message === null || !("method" in message)) return;

    const { method, data } = message as { method: unknown; data: unknown };
    if (typeof method !== "string") return;

    const notification = parseMediaNotification(method, data);
    if (notification === undefined) return;

    if (notification.method === "newProducer") {
      void consume(notification.data.producerId, notification.data.peerId).catch(() => undefined);
      return;
    }

    if (notification.method === "peerClosed") {
      removeParticipant(notification.data.peerId);
    }
  }

  function removeParticipant(peerId: string): void {
    consumersByPeerId.get(peerId)?.close();
    consumersByPeerId.delete(peerId);
    emit({ participants: snapshot.participants.filter((one) => one.peerId !== peerId) });
  }

  async function consume(producerId: string, peerId: string): Promise<void> {
    if (recvTransport === undefined) return;

    const descriptor = await request<ConsumerDescriptor>("consume", {
      transportId: recvTransport.id,
      producerId,
    });
    const consumer = await recvTransport.consume(descriptor as unknown as types.ConsumerOptions);
    await request("resumeConsumer", { consumerId: consumer.id });

    consumersByPeerId.set(peerId, consumer);
    emit({
      participants: [
        ...snapshot.participants.filter((one) => one.peerId !== peerId),
        { peerId, stream: new MediaStream([consumer.track]) },
      ],
    });
  }

  function wireTransport(transport: types.Transport): void {
    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      request("connectTransport", { transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch(errback);
    });
  }

  async function openSocket(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const opened = new WebSocket(options.gatewayUrl);
      socket = opened;

      opened.addEventListener("message", (event) => handleMessage(event.data as string));
      opened.addEventListener("open", () => resolve());
      opened.addEventListener("error", () => reject(new Error("통화 서버에 연결하지 못했습니다.")));
      opened.addEventListener("close", () => {
        // 서버가 끊었거나 네트워크가 끊긴 경우. 재연결 내성은 아직 없다.
        if (snapshot.status !== "idle") {
          teardown();
          emit({ ...IDLE_SNAPSHOT, error: "통화 연결이 끊어졌습니다." });
        }
      });
    });
  }

  // 후속: await 중 leave로 종료해도 참가가 이어질 수 있다. 참가 시도 식별자·취소와 늦게 얻은 자원 정리가 필요하다.
  async function join(): Promise<void> {
    if (snapshot.status !== "idle" && snapshot.status !== "failed") return;

    emit({ status: "joining", error: undefined });

    try {
      // mediasoup-client는 번들이 커서 통화를 시작할 때 처음 불러온다.
      const { Device } = await import("mediasoup-client");

      await openSocket();

      const joined = await request<JoinResult>("join", { roomId: options.roomId });
      device = new Device();
      await device.load({
        routerRtpCapabilities: joined.routerRtpCapabilities as types.RtpCapabilities,
      });
      await request("setRtpCapabilities", { rtpCapabilities: device.rtpCapabilities });

      sendTransport = device.createSendTransport(
        (await request<WebRtcTransportDescriptor>(
          "createWebRtcTransport",
        )) as unknown as types.TransportOptions,
      );
      wireTransport(sendTransport);
      sendTransport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
        request<ProduceResult>("produce", {
          transportId: sendTransport?.id,
          kind,
          rtpParameters,
        })
          .then(({ id }) => callback({ id }))
          .catch(errback);
      });

      recvTransport = device.createRecvTransport(
        (await request<WebRtcTransportDescriptor>(
          "createWebRtcTransport",
        )) as unknown as types.TransportOptions,
      );
      wireTransport(recvTransport);

      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const [track] = localStream.getAudioTracks();

      if (track === undefined) {
        throw new Error("마이크를 사용할 수 없습니다.");
      }

      await sendTransport.produce({ track });

      // 내가 들어오기 전부터 있던 참가자를 받아온다. 이후 참가자는 newProducer 알림으로 온다.
      for (const { producerId, peerId } of await request<ProducerDescriptor[]>("listProducers")) {
        await consume(producerId, peerId);
      }

      emit({ status: "connected" });
    } catch (error) {
      teardown();
      emit({
        ...IDLE_SNAPSHOT,
        status: "failed",
        error: error instanceof Error ? error.message : "통화를 시작하지 못했습니다.",
      });
    }
  }

  function teardown(): void {
    for (const consumer of consumersByPeerId.values()) consumer.close();
    consumersByPeerId.clear();

    sendTransport?.close();
    recvTransport?.close();
    for (const track of localStream?.getTracks() ?? []) track.stop();

    for (const entry of pending.values()) entry.reject(new Error("통화가 종료되었습니다."));
    pending.clear();

    const closing = socket;
    socket = undefined;
    closing?.close();

    sendTransport = undefined;
    recvTransport = undefined;
    localStream = undefined;
    device = undefined;
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    join,
    leave: () => {
      teardown();
      emit(IDLE_SNAPSHOT);
    },
    /**
     * 로컬 음소거만 한다. 상대에게 음소거 상태를 알리는 이벤트가 아직 계약에 없어서,
     * 다른 참가자 화면에는 표시되지 않는다.
     */
    toggleMute: () => {
      const nextMuted = !snapshot.isMuted;

      for (const track of localStream?.getAudioTracks() ?? []) {
        track.enabled = !nextMuted;
      }

      emit({ isMuted: nextMuted });
    },
  };
}
