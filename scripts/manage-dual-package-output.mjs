import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";

const packageRoot = process.cwd();
const packageJsonPath = resolve(packageRoot, "package.json");
const distDirectory = resolve(packageRoot, "dist");
const command = process.argv[2];

await access(packageJsonPath);

if (dirname(distDirectory) !== packageRoot || basename(distDirectory) !== "dist") {
  throw new Error(`안전하지 않은 dist 경로입니다: ${distDirectory}`);
}

if (command === "clean") {
  await rm(distDirectory, { force: true, recursive: true });
  process.exit(0);
}

if (command !== "mark") {
  throw new Error("사용법: manage-dual-package-output.mjs <clean|mark>");
}

await Promise.all(
  [
    ["esm", "module"],
    ["cjs", "commonjs"],
  ].map(async ([directoryName, type]) => {
    const outputDirectory = resolve(distDirectory, directoryName);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(
      resolve(outputDirectory, "package.json"),
      `${JSON.stringify({ type }, null, 2)}\n`,
      "utf8",
    );
  }),
);
