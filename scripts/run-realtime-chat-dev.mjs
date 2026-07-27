import { spawn } from "node:child_process";
import console from "node:console";
import { readFileSync } from "node:fs";
import process from "node:process";
import { setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { parseEnv } from "node:util";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const webDirectory = fileURLToPath(new URL("../apps/web", import.meta.url));
const apiEnvironment = loadTeamInternalEnvironment(
  new URL("../apps/realtime-chat-api/.env.example", import.meta.url),
  {
    PORT: "REALTIME_CHAT_API_PORT",
  },
);
const gatewayEnvironment = loadTeamInternalEnvironment(
  new URL("../apps/realtime-chat-gateway/.env.example", import.meta.url),
  {
    PORT: "REALTIME_CHAT_GATEWAY_PORT",
  },
);
const childShutdownTimeoutMilliseconds =
  Math.max(
    readPositiveSafeInteger(apiEnvironment, "REALTIME_CHAT_SHUTDOWN_GRACE_MS", "realtime-chat-api"),
    readPositiveSafeInteger(
      gatewayEnvironment,
      "REALTIME_CHAT_GATEWAY_SHUTDOWN_GRACE_MS",
      "realtime-chat-gateway",
    ),
  ) + 2_000;

const services = [
  startService(
    "realtime-chat-api",
    process.execPath,
    [fileURLToPath(new URL("../apps/realtime-chat-api/dist/main.js", import.meta.url))],
    apiEnvironment,
  ),
  startService(
    "realtime-chat-gateway",
    process.execPath,
    [fileURLToPath(new URL("../apps/realtime-chat-gateway/dist/main.js", import.meta.url))],
    gatewayEnvironment,
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

function loadTeamInternalEnvironment(fileUrl, aliases = {}) {
  const exampleEnvironment = parseEnv(readFileSync(fileUrl, "utf8"));

  return Object.fromEntries(
    Object.entries(exampleEnvironment).map(([name, exampleValue]) => {
      const sourceName = aliases[name] ?? name;
      const override = process.env[sourceName];

      return [name, override === undefined ? exampleValue : override];
    }),
  );
}

function readPositiveSafeInteger(environment, name, serviceName) {
  const value = Number(environment[name]);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `${serviceName} ${name}은 개발 실행기의 종료 예산 계산을 위해 양의 safe integer여야 합니다.`,
    );
  }

  return value;
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
  }, childShutdownTimeoutMilliseconds).unref();
}
