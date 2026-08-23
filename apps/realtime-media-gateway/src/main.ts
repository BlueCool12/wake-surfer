// walking skeleton — mediasoup SFU로 두 브라우저가 서로의 소리를 듣는 최소 경로.
// 인증, 여러 방, 계약 패키지, 정원 제한은 아직 없다. 이후 단계에서 이 위에 얹는다.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { fileURLToPath, URL } from "node:url";
import console from "node:console";
import process from "node:process";

import * as mediasoup from "mediasoup";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT ?? 4000);

/**
 * 클라이언트에게 알려줄 ICE 주소.
 *
 * 0단계에서 확인했듯 루프백 주소를 쓰면 브라우저가 **에러 없이 조용히** 연결에 실패한다.
 * 반드시 외부에서 도달 가능한 주소여야 하므로 기본값을 localhost로 두지 않는다.
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
  console.error("[media] mediasoup worker 종료. 프로세스를 내린다.");
  process.exit(1);
});

const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
console.log(`[media] worker pid=${worker.pid}, announcedAddress=${ANNOUNCED_ADDRESS}`);

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

const websocketServer = new WebSocketServer({ server: httpServer });

websocketServer.on("connection", (socket) => {
  const peer: Peer = {
    id: `peer_${Math.random().toString(36).slice(2, 10)}`,
    socket,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };
  peers.set(peer.id, peer);
  console.log(`[peer] 접속 ${peer.id} (총 ${peers.size})`);

  send(socket, { method: "welcome", data: { peerId: peer.id } });

  socket.on("message", (raw) => {
    void handleRequest(peer, JSON.parse(raw.toString())).catch((error: unknown) => {
      console.error(`[peer] ${peer.id} 처리 실패`, error);
    });
  });

  socket.once("close", () => {
    for (const transport of peer.transports.values()) transport.close();
    peers.delete(peer.id);
    console.log(`[peer] 종료 ${peer.id} (총 ${peers.size})`);
    broadcast(peer.id, { method: "peerClosed", data: { peerId: peer.id } });
  });
});

type RpcPayload = Record<string, unknown>;

async function handleRequest(
  peer: Peer,
  message: { id?: number; method: string; data?: RpcPayload },
) {
  const { id, method, data } = message;

  try {
    const result = await route(peer, method, data ?? {});
    if (id !== undefined) send(peer.socket, { id, ok: true, data: result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[rpc] ${method} 실패: ${detail}`);
    if (id !== undefined) send(peer.socket, { id, ok: false, error: detail });
  }
}

/**
 * 클라이언트가 보낸 payload는 아직 검증하지 않는다. 각 case가 필요한 모양을 캐스트로 선언하며,
 * 여기 적힌 모양이 곧 계약 패키지에서 스키마로 고정해야 할 대상이다.
 */
async function route(peer: Peer, method: string, data: RpcPayload): Promise<unknown> {
  switch (method) {
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
      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
    }

    case "connectTransport": {
      const { transportId, dtlsParameters } = data as {
        transportId: string;
        dtlsParameters: mediasoup.types.DtlsParameters;
      };
      const transport = peer.transports.get(transportId);
      if (!transport) throw new Error(`transport 없음: ${transportId}`);
      await transport.connect({ dtlsParameters });
      return {};
    }

    case "produce": {
      const { transportId, kind, rtpParameters } = data as {
        transportId: string;
        kind: mediasoup.types.MediaKind;
        rtpParameters: mediasoup.types.RtpParameters;
      };
      const transport = peer.transports.get(transportId);
      if (!transport) throw new Error(`transport 없음: ${transportId}`);
      const producer = await transport.produce({ kind, rtpParameters });
      peer.producers.set(producer.id, producer);
      console.log(`[produce] ${peer.id} → producer ${producer.id}`);
      // 다른 참가자에게 새 producer를 알린다. 그쪽이 consume 요청을 보내온다.
      broadcast(peer.id, {
        method: "newProducer",
        data: { producerId: producer.id, peerId: peer.id },
      });
      return { id: producer.id };
    }

    case "setRtpCapabilities":
      peer.rtpCapabilities = (
        data as { rtpCapabilities: mediasoup.types.RtpCapabilities }
      ).rtpCapabilities;
      return {};

    case "listProducers":
      return [...peers.values()]
        .filter((other) => other.id !== peer.id)
        .flatMap((other) =>
          [...other.producers.keys()].map((producerId) => ({ producerId, peerId: other.id })),
        );

    case "consume": {
      const { transportId, producerId } = data as { transportId: string; producerId: string };
      const transport = peer.transports.get(transportId);
      if (!transport) throw new Error(`transport 없음: ${transportId}`);
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
      console.log(`[consume] ${peer.id} ← producer ${producerId}`);
      return {
        id: consumer.id,
        producerId: consumer.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      };
    }

    case "resumeConsumer": {
      const { consumerId } = data as { consumerId: string };
      const consumer = peer.consumers.get(consumerId);
      if (!consumer) throw new Error(`consumer 없음: ${consumerId}`);
      await consumer.resume();
      return {};
    }

    default:
      throw new Error(`알 수 없는 method: ${method}`);
  }
}

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function broadcast(exceptPeerId: string, payload: unknown) {
  for (const peer of peers.values()) {
    if (peer.id !== exceptPeerId) send(peer.socket, payload);
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

httpServer.listen(PORT, () => console.log(`[http] http://localhost:${PORT}`));
