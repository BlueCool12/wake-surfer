import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const appPackages = new Map([
  ["realtime-chat-api", "@wake-surfer/realtime-chat-api"],
  ["realtime-chat-gateway", "@wake-surfer/realtime-chat-gateway"],
  ["realtime-media-gateway", "@wake-surfer/realtime-media-gateway"],
  ["auth-api", "@wake-surfer/auth-api"],
  ["web", "web"],
]);
const appServices = [...appPackages.keys()];
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
  const targets = target === "all" ? appServices : [target];

  const buildFilters = targets.map((service) => {
    const packageName = appPackages.get(service);

    if (packageName === undefined) {
      throw new Error(`알 수 없는 앱 서비스: ${service}`);
    }

    return `--filter=${packageName}`;
  });

  await runCommand("pnpm", ["exec", "turbo", "run", "build", ...buildFilters]);

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
  return runCommand("docker", ["compose", ...args]);
}

function runCommand(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const usesWindowsCommandShim = process.platform === "win32" && command === "pnpm";
    const executable = usesWindowsCommandShim ? (process.env.ComSpec ?? "cmd.exe") : command;
    const executableArgs = usesWindowsCommandShim ? ["/d", "/s", "/c", "pnpm.cmd", ...args] : args;
    const child = spawn(executable, executableArgs, {
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
          `${command} ${args.join(" ")} 실패 (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    });
  });
}
