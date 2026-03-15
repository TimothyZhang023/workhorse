import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { build } from "esbuild";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const runtimeDir = path.join(repoRoot, "src-tauri", "sidecar-runtime");
const serverEntrySource = path.join(repoRoot, "server.js");
const isWindows = process.platform === "win32";
const runtimeNodeFileName = isWindows ? "node.exe" : "node";
const runtimeNodeSourceCandidates = [
  process.env.WORKHORSE_NODE_BIN,
  path.join(repoRoot, "src-tauri", "sidecar-node", runtimeNodeFileName),
  process.execPath,
].filter(Boolean);

async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function main() {
  console.log("🚀 Starting Optimized Sidecar Build...");
  
  const runtimeNodeSource = runtimeNodeSourceCandidates.find(fs.existsSync);
  if (!runtimeNodeSource) throw new Error("Missing Node runtime.");

  await fsp.rm(runtimeDir, { recursive: true, force: true });
  await fsp.mkdir(runtimeDir, { recursive: true });

  console.log("📦 Bundling server with esbuild...");
  await build({
    entryPoints: [serverEntrySource],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    outfile: path.join(runtimeDir, "server.bundle.js"),
    external: ["better-sqlite3", "@tauri-apps/api", "fsevents"], // Exclude binaries/native
    minify: true,
    sourcemap: true,
  });

  // Copy runtime Node
  await fsp.copyFile(runtimeNodeSource, path.join(runtimeDir, runtimeNodeFileName));

  // Create minimal package.json for external binaries
  const pkg = JSON.parse(await fsp.readFile(path.join(repoRoot, "package.json"), "utf8"));
  const runtimePackageJson = {
    name: "workhorse-sidecar-optimized",
    type: "module",
    dependencies: {
      "better-sqlite3": pkg.dependencies["better-sqlite3"]
    },
  };
  await fsp.writeFile(path.join(runtimeDir, "package.json"), JSON.stringify(runtimePackageJson, null, 2));

  console.log("🛠 Installing external/native dependencies...");
  await runCommand("npm", ["install", "--omit=dev", "--no-package-lock", "--prefix", runtimeDir], { cwd: repoRoot });

  // Rebuild better-sqlite3 for target
  const betterSqliteDir = path.join(runtimeDir, "node_modules", "better-sqlite3");
  if (fs.existsSync(betterSqliteDir)) {
      console.log("🔧 Rebuilding better-sqlite3...");
      await runCommand("npm", ["run", "install"], { cwd: betterSqliteDir });
  }

  // Final Launcher
  const launcherPath = path.join(runtimeDir, isWindows ? "workhorse-server.cmd" : "workhorse-server");
  const script = isWindows 
    ? `@echo off\n"%~dp0${runtimeNodeFileName}" "%~dp0server.bundle.js" %*`
    : `#!/bin/bash\nDIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"\nexec "$DIR/${runtimeNodeFileName}" "$DIR/server.bundle.js" "$@"`;
  
  await fsp.writeFile(launcherPath, script, { mode: 0o755 });
  console.log(`✅ Optimized Sidecar built at ${runtimeDir}`);
}

main().catch(console.error);
