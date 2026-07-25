import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const appServices = ["realtime-chat-api", "realtime-chat-gateway", "web"];
const requestedTarget = process.argv[2] ?? "all";

if (
  process.argv.length > 3 ||
  (requestedTarget !== "all" && !appServices.includes(requestedTarget))
) {
  process.stderr.write(`사용법: npm run deploy -- [${appServices.join("|")}|all]\n`);
  process.exitCode = 1;
} else {
  void deploy(requestedTarget).catch((error) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`[deploy] 실패 ${detail}\n`);
    process.exitCode = 1;
  });
}

async function deploy(target) {
  if (target === "all") {
    await runDockerCompose([
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "60",
      "realtime-chat-postgres",
      "realtime-chat-redis",
    ]);
    await runDockerCompose(["run", "--rm", "--build", "realtime-chat-migrate"]);
  }

  const targets = target === "all" ? appServices : [target];

  await runDockerCompose([
    "up",
    "-d",
    "--build",
    "--no-deps",
    "--force-recreate",
    "--wait",
    "--wait-timeout",
    "60",
    ...targets,
  ]);
}

function runDockerCompose(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("docker", ["compose", ...args], {
      cwd: workspaceRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });

    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(
        new Error(
          `docker compose ${args.join(" ")} 실패 (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    });
  });
}
