// 브라우저 번들을 만든다. esbuild를 직접 호출해 pnpm의 실행 전 의존성 검사를 우회한다
// (그 검사가 재설치를 유발하면 방금 빌드한 mediasoup worker 바이너리가 지워진다).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import console from "node:console";

const require = createRequire(import.meta.url);
const esbuild = require.resolve("esbuild/bin/esbuild");
const appRoot = fileURLToPath(new URL("..", import.meta.url));

execFileSync(
  esbuild,
  ["client/main.ts", "--bundle", "--format=esm", "--outfile=public/dist/client.js"],
  {
    cwd: appRoot,
    stdio: "inherit",
  },
);
console.log("[client] 번들 완료");
