// mediasoup SFU 시그널링 게이트웨이.
// 인증, 재연결 내성, 녹음은 아직 없다. 이후 단계에서 이 위에 얹는다.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

import {
  MAX_FRAME_UTF8_BYTES,
  RequestFrameSchema,
  getUtf8ByteLength,
  parseMediaRequestFrame,
  type ConsumerDescriptor,
  type JoinResult,
  type MediaErrorCode,
  type MediaNotification,
  type MediaRequest,
  type ProduceResult,
  type ProducerDescriptor,
  type WebRtcTransportDescriptor,
} from "@wake-surfer/realtime-media-contracts";
import * as mediasoup from "mediasoup";
import { WebSocketServer, WebSocket } from "ws";

import { createLogger, serializeError } from "./runtime/logger.ts";

const PORT = Number(process.env.PORT ?? 4000);
const MAX_PEERS_PER_ROOM = Number(process.env.MEDIA_MAX_PEERS_PER_ROOM ?? 8);

/** 모든 WebRTC transport가 공유하는 미디어 포트. udp·tcp 양쪽에서 같은 번호를 쓴다. */
const RTC_PORT = Number(process.env.MEDIA_RTC_PORT ?? 44444);

/**
 * worker가 개별 포트를 잡아야 하는 transport에 쓰는 범위.
 *
 * WebRTC transport는 위 `RTC_PORT` 하나를 공유하므로 여기 해당하지 않는다. 녹음을 붙일 때
 * 쓰게 될 PlainTransport 같은 것들이 이 범위에서 포트를 받는다.
 */
const RTC_MIN_PORT = Number(process.env.MEDIA_RTC_MIN_PORT ?? 40000);
const RTC_MAX_PORT = Number(process.env.MEDIA_RTC_MAX_PORT ?? 40100);
const logger = createLogger(process.env.LOG_LEVEL ?? "info");

/**
 * 클라이언트에게 알려줄 ICE 주소.
 *
 * 루프백 주소를 쓰면 브라우저가 **에러 없이 조용히** 연결에 실패한다. 반드시 외부에서 도달
 * 가능한 주소여야 하므로 기본값을 localhost로 두지 않는다.
 */
const ANNOUNCED_ADDRESS = process.env.MEDIASOUP_ANNOUNCED_ADDRESS ?? detectLanAddress();

const MEDIA_CODECS: mediasoup.types.RouterRtpCodecCapability[] = [
  { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
];

/** 방 하나가 Router 하나를 갖는다. Router는 자기 안의 producer끼리만 연결할 수 있는 경계다. */
type Room = {
  id: string;
  router: mediasoup.types.Router;
  peerIds: Set<string>;
};

type Peer = {
  id: string;
  socket: WebSocket;
  roomId?: string | undefined;
  rtpCapabilities?: mediasoup.types.RtpCapabilities;
  transports: Map<string, mediasoup.types.WebRtcTransport>;
  producers: Map<string, mediasoup.types.Producer>;
  consumers: Map<string, mediasoup.types.Consumer>;
};

/**
 * 값이 아니라 **Promise**를 담는다.
 *
 * `createRouter`가 비동기라, 두 참가자가 같은 새 방에 동시에 들어오면 둘 다 "방이 없다"를 보고
 * Router를 각자 만들어 하나가 유실된다. 그 경우 서로의 오디오가 다른 Router에 걸려 들리지 않는다.
 * 생성 중인 Promise를 먼저 등록해 두 번째 요청이 같은 것을 기다리게 한다.
 */
const rooms = new Map<string, Promise<Room>>();
const peers = new Map<string, Peer>();

class MediaRequestError extends Error {
  readonly code: MediaErrorCode;

  constructor(code: MediaErrorCode, message: string) {
    super(message);
    this.name = "MediaRequestError";
    this.code = code;
  }
}

const worker = await mediasoup.createWorker({
  logLevel: "warn",
  rtcMinPort: RTC_MIN_PORT,
  rtcMaxPort: RTC_MAX_PORT,
});
worker.on("died", () => {
  logger.error({ workerPid: worker.pid }, "mediasoup worker가 종료되어 프로세스를 내립니다");
  process.exit(1);
});

/**
 * 모든 WebRTC transport가 공유하는 고정 포트.
 *
 * transport마다 포트를 따로 잡으면 참가자 한 명이 4개(송신·수신 × udp·tcp)를 먹어, 포트 범위가
 * 곧 전역 동시 접속 상한이 된다. WebRtcServer는 ICE username fragment로 트래픽을 구분하므로
 * 포트 하나에 전부 다중화할 수 있다. 방화벽·컨테이너 포트 공개도 한 줄로 끝난다.
 */
const webRtcServer = await worker.createWebRtcServer({
  listenInfos: [
    { protocol: "udp", ip: "0.0.0.0", announcedAddress: ANNOUNCED_ADDRESS, port: RTC_PORT },
    { protocol: "tcp", ip: "0.0.0.0", announcedAddress: ANNOUNCED_ADDRESS, port: RTC_PORT },
  ],
});

logger.info(
  {
    announcedAddress: ANNOUNCED_ADDRESS,
    maxPeersPerRoom: MAX_PEERS_PER_ROOM,
    rtcPort: RTC_PORT,
    workerPid: worker.pid,
  },
  "mediasoup worker 기동",
);

const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const httpServer = createServer(async (request, response) => {
  const requestedPath = (request.url ?? "/").split("?")[0] ?? "/";
  // ".." 를 막지 않으면 public/ 밖의 임의 파일이 노출된다.
  const name = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\//, "");

  if (name.includes("..")) {
    response.writeHead(400).end("bad request");
    return;
  }

  try {
    const body = await readFile(publicDirectory + name);
    const type = name.endsWith(".html")
      ? "text/html; charset=utf-8"
      : "text/javascript; charset=utf-8";
    response.writeHead(200, { "content-type": type });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});

const websocketServer = new WebSocketServer({
  maxPayload: MAX_FRAME_UTF8_BYTES,
  server: httpServer,
});

websocketServer.on("connection", (socket) => {
  const peer: Peer = {
    id: `peer_${randomUUID()}`,
    socket,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };
  peers.set(peer.id, peer);
  logger.info({ peerCount: peers.size, peerId: peer.id }, "peer 접속");

  notify(socket, { method: "welcome", data: { peerId: peer.id } });

  socket.on("message", (raw) => {
    void receive(peer, raw.toString()).catch((error: unknown) => {
      logger.error({ error: serializeError(error), peerId: peer.id }, "peer 프레임 처리 실패");
    });
  });

  socket.once("close", () => {
    void closePeer(peer).catch((error: unknown) => {
      logger.error({ error: serializeError(error), peerId: peer.id }, "peer 정리 실패");
    });
  });
});

/**
 * 클라이언트가 보낸 프레임은 어떤 것도 신뢰하지 않는다.
 *
 * 봉투가 깨졌으면 응답할 `id`조차 없으므로 연결을 닫고, 봉투는 멀쩡한데 payload가 틀렸으면
 * 해당 요청만 실패로 돌려준다.
 */
async function receive(peer: Peer, text: string): Promise<void> {
  if (getUtf8ByteLength(text) > MAX_FRAME_UTF8_BYTES) {
    peer.socket.close(1009, "frame too large");
    return;
  }

  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    peer.socket.close(1008, "invalid json");
    return;
  }

  const frame = RequestFrameSchema.safeParse(json);

  if (!frame.success) {
    peer.socket.close(1008, "invalid request frame");
    return;
  }

  const parsed = parseMediaRequestFrame(frame.data);

  if (!parsed.ok) {
    send(peer.socket, {
      id: frame.data.id,
      ok: false,
      code: parsed.code,
      error: parsed.message,
    });
    return;
  }

  try {
    send(peer.socket, { id: parsed.value.id, ok: true, data: await route(peer, parsed.value) });
  } catch (error) {
    const code = error instanceof MediaRequestError ? error.code : "internal";
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn(
      { code, error: serializeError(error), method: parsed.value.method, peerId: peer.id },
      "요청 처리 실패",
    );
    send(peer.socket, { id: parsed.value.id, ok: false, code, error: detail });
  }
}

/**
 * `request.data`는 계약이 검증한 값이다.
 *
 * 다만 RTP·DTLS 파라미터는 mediasoup이 소유하는 구조라 계약이 형태를 규정하지 않는다.
 * 여기서 mediasoup 타입으로 단언하며, 값이 잘못됐다면 mediasoup이 거절한다.
 */
async function route(peer: Peer, request: MediaRequest): Promise<unknown> {
  switch (request.method) {
    case "join": {
      const room = await joinRoom(peer, request.data.roomId);
      const result: JoinResult = {
        roomId: room.id,
        routerRtpCapabilities: room.router.rtpCapabilities,
        peerCount: room.peerIds.size,
      };
      return result;
    }

    case "createWebRtcTransport": {
      const room = await requireRoom(peer);
      const transport = await room.router.createWebRtcTransport({
        webRtcServer,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });
      peer.transports.set(transport.id, transport);
      const descriptor: WebRtcTransportDescriptor = {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
      return descriptor;
    }

    case "connectTransport": {
      const transport = requireTransport(peer, request.data.transportId);
      await transport.connect({
        dtlsParameters: request.data.dtlsParameters as mediasoup.types.DtlsParameters,
      });
      return {};
    }

    case "setRtpCapabilities":
      peer.rtpCapabilities = request.data.rtpCapabilities as mediasoup.types.RtpCapabilities;
      return {};

    case "produce": {
      const room = await requireRoom(peer);
      const transport = requireTransport(peer, request.data.transportId);
      const producer = await transport.produce({
        kind: request.data.kind,
        rtpParameters: request.data.rtpParameters as mediasoup.types.RtpParameters,
      });
      peer.producers.set(producer.id, producer);
      logger.info({ peerId: peer.id, producerId: producer.id, roomId: room.id }, "producer 생성");
      // 같은 방의 다른 참가자에게 알린다. 그쪽이 consume 요청을 보내온다.
      await broadcastToRoom(room, peer.id, {
        method: "newProducer",
        data: { producerId: producer.id, peerId: peer.id },
      });
      const result: ProduceResult = { id: producer.id };
      return result;
    }

    case "listProducers": {
      const room = await requireRoom(peer);
      const descriptors: ProducerDescriptor[] = [...room.peerIds]
        .filter((peerId) => peerId !== peer.id)
        .flatMap((peerId) => {
          const other = peers.get(peerId);
          return other === undefined
            ? []
            : [...other.producers.keys()].map((producerId) => ({ producerId, peerId }));
        });
      return descriptors;
    }

    case "consume": {
      const room = await requireRoom(peer);
      const { transportId, producerId } = request.data;
      const transport = requireTransport(peer, transportId);

      if (!peer.rtpCapabilities) {
        throw new MediaRequestError("not_joined", "rtpCapabilities가 아직 등록되지 않았습니다.");
      }

      if (!room.router.canConsume({ producerId, rtpCapabilities: peer.rtpCapabilities })) {
        throw new MediaRequestError("not_found", `consume 불가: ${producerId}`);
      }

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities: peer.rtpCapabilities,
        paused: true, // 먼저 만들고 클라이언트 준비 후 resume 하는 것이 권장 순서다.
      });
      peer.consumers.set(consumer.id, consumer);
      // producer가 닫히면 mediasoup이 consumer도 닫는다. Map에 죽은 항목이 쌓이지 않게 지운다.
      consumer.on("producerclose", () => {
        peer.consumers.delete(consumer.id);
        logger.info(
          { consumerId: consumer.id, peerId: peer.id },
          "producer 종료에 따라 consumer 정리",
        );
      });
      logger.info(
        { consumerId: consumer.id, peerId: peer.id, producerId, roomId: room.id },
        "consumer 생성",
      );
      const descriptor: ConsumerDescriptor = {
        id: consumer.id,
        producerId: consumer.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      };
      return descriptor;
    }

    case "resumeConsumer": {
      const consumer = peer.consumers.get(request.data.consumerId);

      if (!consumer) {
        throw new MediaRequestError("not_found", `consumer 없음: ${request.data.consumerId}`);
      }

      await consumer.resume();
      return {};
    }
  }
}

// ── 방 생명주기 ─────────────────────────────────────────────────────────────

async function joinRoom(peer: Peer, roomId: string): Promise<Room> {
  if (peer.roomId !== undefined) {
    throw new MediaRequestError("already_joined", `이미 ${peer.roomId}에 참가 중입니다.`);
  }

  const room = await getOrCreateRoom(roomId);

  if (room.peerIds.size >= MAX_PEERS_PER_ROOM) {
    throw new MediaRequestError("room_full", `방 정원(${MAX_PEERS_PER_ROOM}명)이 찼습니다.`);
  }

  room.peerIds.add(peer.id);
  peer.roomId = roomId;
  logger.info({ peerCount: room.peerIds.size, peerId: peer.id, roomId }, "방 참가");
  return room;
}

function getOrCreateRoom(roomId: string): Promise<Room> {
  const pending = rooms.get(roomId);

  if (pending !== undefined) {
    return pending;
  }

  const creating = worker
    .createRouter({ mediaCodecs: MEDIA_CODECS })
    .then((router) => {
      logger.info({ roomId }, "방 생성");
      return { id: roomId, router, peerIds: new Set<string>() };
    })
    .catch((error: unknown) => {
      // 실패한 Promise가 남으면 이후 참가가 전부 같은 실패를 재사용한다.
      rooms.delete(roomId);
      throw error;
    });

  rooms.set(roomId, creating);
  return creating;
}

async function requireRoom(peer: Peer): Promise<Room> {
  if (peer.roomId === undefined) {
    throw new MediaRequestError("not_joined", "먼저 join 해야 합니다.");
  }

  const pending = rooms.get(peer.roomId);

  if (pending === undefined) {
    throw new MediaRequestError("not_found", `방이 없습니다: ${peer.roomId}`);
  }

  return pending;
}

/** 참가자가 나갈 때 방에서 제거하고, 마지막 한 명이었으면 Router까지 닫는다. */
async function leaveRoom(peer: Peer): Promise<void> {
  const roomId = peer.roomId;

  if (roomId === undefined) {
    return;
  }

  peer.roomId = undefined;
  const pending = rooms.get(roomId);

  if (pending === undefined) {
    return;
  }

  const room = await pending;
  room.peerIds.delete(peer.id);
  await broadcastToRoom(room, peer.id, { method: "peerClosed", data: { peerId: peer.id } });

  if (room.peerIds.size === 0) {
    rooms.delete(roomId);
    room.router.close();
    logger.info({ roomId }, "마지막 참가자가 나가 방을 닫습니다");
  }
}

async function closePeer(peer: Peer): Promise<void> {
  for (const transport of peer.transports.values()) {
    transport.close();
  }

  peers.delete(peer.id);
  await leaveRoom(peer);
  logger.info({ peerCount: peers.size, peerId: peer.id }, "peer 종료");
}

// ── 전송 도우미 ─────────────────────────────────────────────────────────────

function requireTransport(peer: Peer, transportId: string): mediasoup.types.WebRtcTransport {
  const transport = peer.transports.get(transportId);

  if (!transport) {
    throw new MediaRequestError("not_found", `transport 없음: ${transportId}`);
  }

  return transport;
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function notify(socket: WebSocket, notification: MediaNotification): void {
  send(socket, notification);
}

async function broadcastToRoom(
  room: Room,
  exceptPeerId: string,
  notification: MediaNotification,
): Promise<void> {
  for (const peerId of room.peerIds) {
    if (peerId === exceptPeerId) continue;

    const peer = peers.get(peerId);
    if (peer !== undefined) notify(peer.socket, notification);
  }
}

function detectLanAddress(): string {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }

  throw new Error("LAN 주소를 찾지 못했습니다. MEDIASOUP_ANNOUNCED_ADDRESS를 지정하세요.");
}

httpServer.listen(PORT, () => logger.info({ port: PORT }, "HTTP·WebSocket 수신 시작"));
