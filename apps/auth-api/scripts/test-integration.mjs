import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { setTimeout } from "node:timers";
import console from "node:console";
import process from "node:process";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const name = `wake-auth-test-${randomUUID()}`;
function command(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} failed: ${result.stderr ?? ""}`);
  return result.stdout?.trim() ?? "";
}
// 매 실행 전용 컨테이너를 생성하며 개발 DB URL은 사용하지 않는다.
try {
  command("pnpm", ["exec", "turbo", "run", "build", "--filter=@wake-surfer/auth-api"], {
    stdio: "inherit",
  });
  command("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_USER=auth_test",
    "-e",
    "POSTGRES_PASSWORD=auth_test",
    "-e",
    "POSTGRES_DB=auth_test",
    "-p",
    "127.0.0.1::5432",
    "postgres:17-alpine",
  ]);
  const port = command("docker", ["port", name, "5432/tcp"]).split(":").at(-1);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync(
      "docker",
      ["exec", name, "pg_isready", "-U", "auth_test", "-d", "auth_test"],
      { stdio: "ignore" },
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Test PostgreSQL did not become ready");
  const url = `postgresql://auth_test:auth_test@127.0.0.1:${port}/auth_test?schema=auth`;
  const env = { ...process.env, DATABASE_URL: url, AUTH_TEST_DATABASE_URL: url };
  command("pnpm", ["exec", "prisma", "migrate", "deploy"], { env, stdio: "inherit" });
  command("pnpm", ["exec", "vitest", "run", "--config", "vitest.integration.config.mts"], {
    env,
    stdio: "inherit",
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Integration test failed");
  process.exitCode = 1;
} finally {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
}
