// mediasoup worker 바이너리를 빌드한다.
//
// macOS 12 / Intel(Apple clang 14) 환경 때문에 두 가지 우회가 필요하다. 둘 다 upstream 문제이고,
// Linux 또는 최신 툴체인에서는 이 스크립트 없이 `pnpm install`만으로 빌드된다.
//
//  1) mediasoup의 DependencyDescriptor.hpp가 표준 컨테이너 헤더를 전이적 포함에 의존한다.
//     clang 14의 libc++는 그걸 제공하지 않아 컴파일이 깨진다. 누락된 include를 넣어준다.
//  2) Homebrew Python에 CA 인증서가 설정돼 있지 않아 meson이 의존성(libuv 등)을 받지 못한다.
//     시스템 CA 번들을 SSL_CERT_FILE로 지정한다.
//
// mediasoup을 3.19.18 이상으로 올리면 C++20 ranges를 요구해 이 환경에서는 빌드가 불가능하다.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import console from "node:console";
import process from "node:process";

const MISSING_INCLUDES = ["<string>", "<unordered_map>", "<vector>", "<memory>"];
const CA_BUNDLE_CANDIDATES = [
  process.env.SSL_CERT_FILE,
  "/usr/local/etc/ca-certificates/cert.pem",
  "/opt/homebrew/etc/ca-certificates/cert.pem",
  "/etc/ssl/cert.pem",
];

const require = createRequire(import.meta.url);
const packageRoot = findPackageRoot(require.resolve("mediasoup"));
const workerBinary = join(packageRoot, "worker/out/Release/mediasoup-worker");

if (existsSync(workerBinary) && !process.argv.includes("--force")) {
  console.log(`[worker] 이미 빌드됨: ${workerBinary}`);
  process.exit(0);
}

applyMissingIncludes(join(packageRoot, "worker/include/RTC/RTP/Codecs/DependencyDescriptor.hpp"));

const caBundle = CA_BUNDLE_CANDIDATES.find((path) => path && existsSync(path));

if (caBundle === undefined) {
  throw new Error("CA 번들을 찾지 못했습니다. SSL_CERT_FILE을 직접 지정하세요.");
}

console.log(`[worker] 빌드 시작 (CA: ${caBundle}). 처음이면 10분 이상 걸립니다.`);
execFileSync(process.execPath, ["npm-scripts.mjs", "worker:build"], {
  cwd: packageRoot,
  stdio: "inherit",
  env: { ...process.env, SSL_CERT_FILE: caBundle, REQUESTS_CA_BUNDLE: caBundle },
});

if (!existsSync(workerBinary)) {
  throw new Error(`빌드는 끝났으나 바이너리가 없습니다: ${workerBinary}`);
}

console.log(`[worker] 완료: ${workerBinary}`);

function findPackageRoot(entryPath) {
  let current = dirname(entryPath);

  while (!existsSync(join(current, "package.json"))) {
    const parent = dirname(current);

    if (parent === current) {
      throw new Error(`mediasoup 패키지 루트를 찾지 못했습니다: ${entryPath}`);
    }

    current = parent;
  }

  return current;
}

function applyMissingIncludes(headerPath) {
  const source = readFileSync(headerPath, "utf8");
  const absent = MISSING_INCLUDES.filter((header) => !source.includes(`#include ${header}`));

  if (absent.length === 0) {
    console.log("[worker] 헤더 패치 불필요");
    return;
  }

  const anchor = "#include <optional>";

  if (!source.includes(anchor)) {
    throw new Error(`패치 기준점을 찾지 못했습니다: ${headerPath}`);
  }

  const patched = source.replace(
    anchor,
    [anchor, ...absent.map((h) => `#include ${h}`)].join("\n"),
  );
  writeFileSync(headerPath, patched);
  console.log(`[worker] 헤더 패치 적용: ${absent.join(", ")}`);
}
