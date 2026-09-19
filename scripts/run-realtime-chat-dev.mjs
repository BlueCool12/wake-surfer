import { spawn } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";

const gatewayApiToken =
  process.env.REALTIME_CHAT_GATEWAY_API_TOKEN ?? "wake-surfer-local-gateway-token-change-me";
const databaseUrl =
  process.env.REALTIME_CHAT_DATABASE_URL ??
  "postgresql://wake_surfer_realtime_chat:wake_surfer_realtime_chat_dev_password@localhost:5432/wake_surfer_realtime_chat?options=-c%20search_path%3Drealtime_chat%2Cpublic";
const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const webDirectory = fileURLToPath(new URL("../apps/web", import.meta.url));

const services = [
  startService(
    "realtime-chat-api",
    process.execPath,
    [fileURLToPath(new URL("../apps/realtime-chat-api/dist/main.js", import.meta.url))],
    {
      LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
      NODE_ENV: "development",
      PORT: process.env.REALTIME_CHAT_API_PORT ?? "3000",
      REALTIME_CHAT_ACTOR_AUTH_SECURITY: "development",
      REALTIME_CHAT_CORS_ALLOWED_ORIGINS:
        process.env.REALTIME_CHAT_CORS_ALLOWED_ORIGINS ??
        "http://localhost:5173,http://127.0.0.1:5173",
      REALTIME_CHAT_DATABASE_URL: databaseUrl,
      REALTIME_CHAT_GATEWAY_API_TOKEN: gatewayApiToken,
      REALTIME_CHAT_GATEWAY_ID: "gateway-1",
      REALTIME_CHAT_GATEWAY_URL:
        process.env.REALTIME_CHAT_GATEWAY_URL ?? "ws://localhost:3001/realtime-chat",
      REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY: "development",
    },
  ),
  startService(
    "realtime-chat-gateway",
    process.execPath,
    [fileURLToPath(new URL("../apps/realtime-chat-gateway/dist/main.js", import.meta.url))],
    {
      LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
      NODE_ENV: "development",
      PORT: process.env.REALTIME_CHAT_GATEWAY_PORT ?? "3001",
      REALTIME_CHAT_API_BASE_URL: process.env.REALTIME_CHAT_API_BASE_URL ?? "http://localhost:3000",
      REALTIME_CHAT_GATEWAY_API_TOKEN: gatewayApiToken,
      REALTIME_CHAT_GATEWAY_ID: "gateway-1",
      REALTIME_CHAT_GATEWAY_PATH: "/realtime-chat",
      REALTIME_CHAT_INTERNAL_TRANSPORT_SECURITY: "development",
      REALTIME_CHAT_GATEWAY_ALLOWED_ORIGINS:
        process.env.REALTIME_CHAT_GATEWAY_ALLOWED_ORIGINS ??
        "http://localhost:5173,http://127.0.0.1:5173",
    },
  ),
  startService(
    "web",
    process.execPath,
    [
      fileURLToPath(new URL("../apps/web/node_modules/vite/bin/vite.js", import.meta.url)),
      "--host",
      "localhost",
    ],
    {
      VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? "http://localhost:3000",
    },
    webDirectory,
  ),
];

let stopping = false;

for (const service of services) {
  service.child.once("error", (error) => {
    if (stopping) {
      return;
    }

    console.error(`[dev:realtime-chat] ${service.name} 시작 실패`, error);
    stopAll(1);
  });
  service.child.once("exit", (code, signal) => {
    if (stopping) {
      return;
    }

    console.error(
      `[dev:realtime-chat] ${service.name} 종료 (code=${String(code)}, signal=${String(signal)})`,
    );
    stopAll(code ?? 1);
  });
}

process.once("SIGINT", () => stopAll(0));
process.once("SIGTERM", () => stopAll(0));

function startService(name, command, args, serviceEnv, cwd = workspaceRoot) {
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...serviceEnv,
    },
    stdio: "inherit",
    windowsHide: true,
  });

  return { child, name };
}

function stopAll(exitCode) {
  if (stopping) {
    return;
  }

  stopping = true;
  process.exitCode = exitCode;

  for (const { child } of services) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const { child } of services) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 3_000).unref();
}
