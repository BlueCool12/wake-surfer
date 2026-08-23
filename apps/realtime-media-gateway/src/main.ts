// mediasoup SFU 시그널링 게이트웨이.
// 인증, 여러 방, 정원 제한, 재연결 내성, 녹음은 아직 없다. 이후 단계에서 이 위에 얹는다.
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

type Peer = {
  id: string;
  socket: WebSocket;
  rtpCapabilities?: mediasoup.types.RtpCapabilities;
  transports: Map<string, mediasoup.types.WebRtcTransport>;
  producers: Map<string, mediasoup.types.Producer>;
  consumers: Map<string, mediasoup.types.Consumer>;
};

const peers = new Map<string, Peer>();

const worker = await mediasoup.createWorker({
  logLevel: "warn",
  rtcMinPort: 40000,
  rtcMaxPort: 40100,
});
worker.on("died", () => {
  logger.error({ workerPid: worker.pid }, "mediasoup worker가 종료되어 프로세스를 내립니다");
  process.exit(1);
});

const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
logger.info(
  { announcedAddress: ANNOUNCED_ADDRESS, workerPid: worker.pid },
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
    id: `peer_${Math.random().toString(36).slice(2, 10)}`,
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
    for (const transport of peer.transports.values()) transport.close();
    peers.delete(peer.id);
    logger.info({ peerCount: peers.size, peerId: peer.id }, "peer 종료");
    broadcast(peer.id, { method: "peerClosed", data: { peerId: peer.id } });
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
    send(peer.socket, { id: frame.data.id, ok: false, error: parsed.message });
    return;
  }

  try {
    send(peer.socket, { id: parsed.value.id, ok: true, data: await route(peer, parsed.value) });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn(
      { error: serializeError(error), method: parsed.value.method, peerId: peer.id },
      "요청 처리 실패",
    );
    send(peer.socket, { id: parsed.value.id, ok: false, error: detail });
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
    case "getRouterRtpCapabilities":
      return router.rtpCapabilities;

    case "createWebRtcTransport": {
      const transport = await router.createWebRtcTransport({
        listenInfos: [
          { protocol: "udp", ip: "0.0.0.0", announcedAddress: ANNOUNCED_ADDRESS },
          { protocol: "tcp", ip: "0.0.0.0", announcedAddress: ANNOUNCED_ADDRESS },
        ],
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
      const transport = requireTransport(peer, request.data.transportId);
      const producer = await transport.produce({
        kind: request.data.kind,
        rtpParameters: request.data.rtpParameters as mediasoup.types.RtpParameters,
      });
      peer.producers.set(producer.id, producer);
      logger.info({ peerId: peer.id, producerId: producer.id }, "producer 생성");
      // 다른 참가자에게 새 producer를 알린다. 그쪽이 consume 요청을 보내온다.
      broadcast(peer.id, {
        method: "newProducer",
        data: { producerId: producer.id, peerId: peer.id },
      });
      const result: ProduceResult = { id: producer.id };
      return result;
    }

    case "listProducers": {
      const descriptors: ProducerDescriptor[] = [...peers.values()]
        .filter((other) => other.id !== peer.id)
        .flatMap((other) =>
          [...other.producers.keys()].map((producerId) => ({ producerId, peerId: other.id })),
        );
      return descriptors;
    }

    case "consume": {
      const { transportId, producerId } = request.data;
      const transport = requireTransport(peer, transportId);

      if (!peer.rtpCapabilities) throw new Error("rtpCapabilities가 아직 없음");
      if (!router.canConsume({ producerId, rtpCapabilities: peer.rtpCapabilities })) {
        throw new Error(`consume 불가: ${producerId}`);
      }

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities: peer.rtpCapabilities,
        paused: true, // 먼저 만들고 클라이언트 준비 후 resume 하는 것이 권장 순서다.
      });
      peer.consumers.set(consumer.id, consumer);
      logger.info({ consumerId: consumer.id, peerId: peer.id, producerId }, "consumer 생성");
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
      if (!consumer) throw new Error(`consumer 없음: ${request.data.consumerId}`);
      await consumer.resume();
      return {};
    }
  }
}

function requireTransport(peer: Peer, transportId: string): mediasoup.types.WebRtcTransport {
  const transport = peer.transports.get(transportId);

  if (!transport) {
    throw new Error(`transport 없음: ${transportId}`);
  }

  return transport;
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function notify(socket: WebSocket, notification: MediaNotification): void {
  send(socket, notification);
}

function broadcast(exceptPeerId: string, notification: MediaNotification): void {
  for (const peer of peers.values()) {
    if (peer.id !== exceptPeerId) notify(peer.socket, notification);
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
