import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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
    await prepareNodeRuntimeWorkspace(stagingDirectory, service.packageName);
  } else {
    await cp(resolve(appRoot, "dist"), stagingDirectory, { recursive: true });
  }

  await rm(artifactRoot, { force: true, recursive: true });
  await mkdir(dockerRoot, { recursive: true });
  await rename(stagingDirectory, artifactRoot);
}

async function prepareNodeRuntimeWorkspace(stagingDirectory, rootPackageName) {
  const workspacePackages = await readWorkspacePackages();
  const selectedPackages = collectRuntimeWorkspacePackages(workspacePackages, rootPackageName);

  await mkdir(stagingDirectory, { recursive: true });
  await cp(resolve(workspaceRoot, "package.json"), resolve(stagingDirectory, "package.json"));
  await cp(resolve(workspaceRoot, "pnpm-lock.yaml"), resolve(stagingDirectory, "pnpm-lock.yaml"));
  await writeFile(
    resolve(stagingDirectory, "pnpm-workspace.yaml"),
    [
      "packages:",
      '  - "apps/*"',
      '  - "packages/*"',
      "injectWorkspacePackages: true",
      "nodeLinker: hoisted",
      "packageImportMethod: copy",
      "allowBuilds:",
      "  cpu-features: true",
      "  esbuild: true",
      "  protobufjs: true",
      "  ssh2: true",
      "",
    ].join("\n"),
    "utf8",
  );

  for (const workspacePackage of selectedPackages) {
    const targetRoot = resolve(stagingDirectory, workspacePackage.relativeDirectory);
    await mkdir(targetRoot, { recursive: true });
    await cp(workspacePackage.packageJsonPath, resolve(targetRoot, "package.json"));
    await cp(resolve(workspacePackage.root, "dist"), resolve(targetRoot, "dist"), {
      recursive: true,
    });
  }

  await runPnpm(
    ["--filter", `${rootPackageName}...`, "install", "--prod", "--offline", "--no-frozen-lockfile"],
    stagingDirectory,
  );
}

async function readWorkspacePackages() {
  const packagesByName = new Map();

  for (const parentDirectory of ["apps", "packages"]) {
    const parentRoot = resolve(workspaceRoot, parentDirectory);
    const entries = await readdir(parentRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const root = resolve(parentRoot, entry.name);
      const packageJsonPath = resolve(root, "package.json");
      let packageJson;

      try {
        packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") {
          continue;
        }

        throw error;
      }

      if (typeof packageJson.name !== "string" || packageJson.name.length === 0) {
        continue;
      }

      packagesByName.set(packageJson.name, {
        packageJson,
        packageJsonPath,
        relativeDirectory: relative(workspaceRoot, root),
        root,
      });
    }
  }

  return packagesByName;
}

function collectRuntimeWorkspacePackages(packagesByName, rootPackageName) {
  const selected = new Map();
  const pending = [rootPackageName];

  while (pending.length > 0) {
    const packageName = pending.pop();

    if (selected.has(packageName)) {
      continue;
    }

    const workspacePackage = packagesByName.get(packageName);

    if (workspacePackage === undefined) {
      throw new Error(`runtime workspace package을 찾을 수 없습니다: ${packageName}`);
    }

    selected.set(packageName, workspacePackage);

    for (const dependencySection of [
      workspacePackage.packageJson.dependencies,
      workspacePackage.packageJson.optionalDependencies,
      workspacePackage.packageJson.peerDependencies,
    ]) {
      for (const [dependencyName, version] of Object.entries(dependencySection ?? {})) {
        if (typeof version === "string" && version.startsWith("workspace:")) {
          pending.push(dependencyName);
        }
      }
    }
  }

  return [...selected.values()];
}

function assertOwnedPath(ownerRoot, candidate, label) {
  const relativePath = relative(ownerRoot, candidate);

  if (relativePath.length === 0 || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${label} 경로가 소유 경계 밖입니다: ${candidate}`);
  }
}

function runPnpm(args, cwd = workspaceRoot) {
  if (process.platform === "win32") {
    return run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm.cmd", ...args], cwd);
  }

  return run("pnpm", args, cwd);
}

function run(command, args, cwd = workspaceRoot) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
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
