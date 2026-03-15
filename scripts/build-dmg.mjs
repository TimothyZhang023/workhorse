import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const packageJsonPath = path.join(repoRoot, "package.json");
const packageJson = JSON.parse(await fsp.readFile(packageJsonPath, "utf8"));
const productName = packageJson.name || "workhorse";
const version = packageJson.version || "0.0.0";
const archLabel = process.arch === "arm64" ? "aarch64" : "x64";
const appPath = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  `${productName}.app`
);
const outputDir = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "dmg"
);
const outputPath = path.join(outputDir, `${productName}_${version}_${archLabel}.dmg`);

await fsp.mkdir(outputDir, { recursive: true });
await fsp.rm(outputPath, { force: true });

import os from "node:os";

const stagingDir = path.join(os.tmpdir(), `workhorse-dmg-${Date.now()}`);
await fsp.mkdir(stagingDir, { recursive: true });

// Copy app to staging
console.log(`Staging app to ${stagingDir}...`);
await new Promise((resolve, reject) => {
  const cp = spawn("cp", ["-R", appPath, stagingDir], { stdio: "inherit" });
  cp.on("error", reject);
  cp.on("close", (code) => (code === 0 ? resolve() : reject(new Error("cp failed"))));
});

// Create Applications symlink
console.log("Creating Applications symlink...");
await fsp.symlink("/Applications", path.join(stagingDir, "Applications"));

await new Promise((resolve, reject) => {
  const child = spawn(
    "hdiutil",
    [
      "create",
      "-volname",
      productName,
      "-srcfolder",
      stagingDir,
      "-ov",
      "-format",
      "UDZO",
      outputPath,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
    }
  );

  child.on("error", reject);
  child.on("close", async (code) => {
    // Cleanup staging
    await fsp.rm(stagingDir, { recursive: true, force: true });
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`hdiutil exited with code ${code}`));
  });
});

console.log(`Built dmg at ${outputPath}`);
