import { spawn } from "node:child_process";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import process from "node:process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const stagingRoot = resolve(workspaceRoot, ".deploy");
const services = new Map([
  [
    "realtime-chat-api",
    {
      appDirectory: "realtime-chat-api",
      kind: "node",
      packageName: "@wake-surfer/realtime-chat-api",
    },
  ],
  [
    "realtime-chat-gateway",
    {
      appDirectory: "realtime-chat-gateway",
      kind: "node",
      packageName: "@wake-surfer/realtime-chat-gateway",
    },
  ],
  [
    "web",
    {
      appDirectory: "web",
      kind: "web",
      packageName: "web",
    },
  ],
]);

const requestedTarget = process.argv[2] ?? "all";

if (process.argv.length > 3 || (requestedTarget !== "all" && !services.has(requestedTarget))) {
  console.error(`사용법: npm run deploy -- [${[...services.keys()].join("|")}|all]`);
  process.exitCode = 1;
} else {
  void deploy(requestedTarget).catch((error) => {
    console.error("[deploy] 실패", error);
    process.exitCode = 1;
  });
}

async function deploy(target) {
  const selectedServices =
    target === "all" ? [...services.entries()] : [[target, services.get(target)]];

  for (const [serviceName, service] of selectedServices) {
    await prepareRuntimeArtifact(serviceName, service);
  }

  if (target === "all") {
    await run("docker", [
      "compose",
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "60",
      "realtime-chat-postgres",
      "realtime-chat-redis",
    ]);
    await run("docker", ["compose", "run", "--rm", "--build", "realtime-chat-migrate"]);
  }

  await run("docker", [
    "compose",
    "up",
    "-d",
    "--build",
    "--no-deps",
    "--wait",
    "--wait-timeout",
    "60",
    ...selectedServices.map(([serviceName]) => serviceName),
  ]);
}

async function prepareRuntimeArtifact(serviceName, service) {
  const appRoot = resolve(workspaceRoot, "apps", service.appDirectory);
  const dockerRoot = resolve(appRoot, "docker");
  const artifactRoot = resolve(dockerRoot, "artifact");
  const stagingDirectory = resolve(stagingRoot, serviceName);

  assertOwnedPath(workspaceRoot, stagingDirectory, ".deploy staging");
  assertOwnedPath(dockerRoot, artifactRoot, `${serviceName} artifact`);

  console.log(`[deploy] ${serviceName} 로컬 빌드`);
  await runPnpm(["--filter", service.packageName, "build"]);

  await rm(stagingDirectory, { force: true, recursive: true });
  await mkdir(dirname(stagingDirectory), { recursive: true });

  if (service.kind === "node") {
    await runPnpm([
      "--filter",
      service.packageName,
      "--prod",
      "deploy",
      "--legacy",
      stagingDirectory,
    ]);
  } else {
    await cp(resolve(appRoot, "dist"), stagingDirectory, { recursive: true });
  }

  await rm(artifactRoot, { force: true, recursive: true });
  await mkdir(dockerRoot, { recursive: true });
  await rename(stagingDirectory, artifactRoot);
}

function assertOwnedPath(ownerRoot, candidate, label) {
  const relativePath = relative(ownerRoot, candidate);

  if (relativePath.length === 0 || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${label} 경로가 소유 경계 밖입니다: ${candidate}`);
  }
}

function runPnpm(args) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return run(command, args, { shell: process.platform === "win32" });
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: process.env,
      shell: options.shell ?? false,
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
