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
const bundleFileName = "server.cjs";
const runtimeNodeSourceCandidates = [
  process.env.WORKHORSE_NODE_BIN,
  path.join(repoRoot, "src-tauri", "sidecar-node", runtimeNodeFileName),
  path.join(repoRoot, "src-tauri", "sidecar-node", "node"),
  "/Users/zts/.antcli_agent/local_agent/node",
  process.execPath,
].filter(Boolean);
const runtimeDependencyNames = ["better-sqlite3", "pino", "pino-http", "pino-pretty"];

async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findBinary(command) {
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const suffixes = isWindows ? ["", ".exe", ".cmd", ".bat"] : [""];

  for (const entry of pathEntries) {
    for (const suffix of suffixes) {
      const candidate = path.join(entry, `${command}${suffix}`);
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

async function resolveExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && (await pathExists(candidate))) {
      return candidate;
    }
  }

  return null;
}

async function resolveNpmCliPath() {
  const npmRootOutput = [];
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["root", "-g"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "inherit"],
    });

    child.stdout.on("data", (chunk) => {
      npmRootOutput.push(String(chunk));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm root -g exited with code ${code}`));
    });
  });

  const npmGlobalRoot = npmRootOutput.join("").trim();
  const npmCliPath = await resolveExistingPath([
    path.join(npmGlobalRoot, "npm", "bin", "npm-cli.js"),
    "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
    "/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js",
  ]);

  const nodeGypPath = await resolveExistingPath([
    path.join(npmGlobalRoot, "npm", "node_modules", "node-gyp", "bin", "node-gyp.js"),
    "/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js",
    "/opt/homebrew/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js",
  ]);

  return { npmCliPath, nodeGypPath };
}

async function stripBinary(binaryPath) {
  if (isWindows || !(await pathExists(binaryPath))) {
    return;
  }

  const stripCommand = await findBinary("strip");
  if (!stripCommand) {
    return;
  }

  try {
    await runCommand(stripCommand, ["-x", binaryPath]);
  } catch (error) {
    console.warn(`strip skipped for ${binaryPath}: ${error.message}`);
  }
}

async function ensureExecutableSignature(binaryPath) {
  if (process.platform !== "darwin" || !(await pathExists(binaryPath))) {
    return;
  }

  const codesignCommand = await findBinary("codesign");
  if (!codesignCommand) {
    return;
  }

  try {
    await runCommand(codesignCommand, ["--verify", "--strict", "--verbose=2", binaryPath]);
  } catch (error) {
    console.warn(
      `codesign verify failed for ${binaryPath}, applying ad-hoc signature: ${error.message}`
    );
    await runCommand(codesignCommand, ["--force", "--sign", "-", binaryPath]);
    await runCommand(codesignCommand, ["--verify", "--strict", "--verbose=2", binaryPath]);
  }
}

async function pruneRuntimeFiles() {
  const betterSqliteDir = path.join(runtimeDir, "node_modules", "better-sqlite3");
  const removablePaths = [
    path.join(runtimeDir, ".package-lock.json"),
    path.join(runtimeDir, "package-lock.json"),
    path.join(runtimeDir, "npm-shrinkwrap.json"),
    path.join(runtimeDir, `${bundleFileName}.map`),
    path.join(runtimeDir, "node_modules", ".package-lock.json"),
    path.join(betterSqliteDir, "deps"),
    path.join(betterSqliteDir, "src"),
  ];

  await Promise.all(
    removablePaths.map((targetPath) =>
      fsp.rm(targetPath, { recursive: true, force: true })
    )
  );
}

async function main() {
  const runtimeNodeSource = await resolveExistingPath(runtimeNodeSourceCandidates);
  if (!runtimeNodeSource) {
    throw new Error(
      `Missing Node runtime. Checked: ${runtimeNodeSourceCandidates.join(", ")}`
    );
  }

  const { npmCliPath, nodeGypPath } = await resolveNpmCliPath();
  if (!npmCliPath) {
    throw new Error("Unable to locate npm-cli.js for sidecar runtime build");
  }
  if (!nodeGypPath) {
    throw new Error("Unable to locate node-gyp.js for sidecar runtime build");
  }

  const rootPackagePath = path.join(repoRoot, "package.json");
  const rootPackage = JSON.parse(await fsp.readFile(rootPackagePath, "utf8"));
  const runtimeDependencies = {};

  for (const dependencyName of runtimeDependencyNames) {
    const version = rootPackage.dependencies?.[dependencyName];
    if (!version) {
      throw new Error(`Missing runtime dependency version for ${dependencyName}`);
    }
    runtimeDependencies[dependencyName] = version;
  }

  await fsp.rm(runtimeDir, { recursive: true, force: true });
  await fsp.mkdir(runtimeDir, { recursive: true });

  const runtimeNodePath = path.join(runtimeDir, runtimeNodeFileName);
  await fsp.copyFile(runtimeNodeSource, runtimeNodePath);

  // Fix for macOS Homebrew Node dynamic links
  if (process.platform === "darwin") {
    try {
      const { execSync } = await import("node:child_process");
      const libs = execSync(`otool -L "${runtimeNodeSource}"`).toString();
      const lines = libs.split("\n");
      for (const line of lines) {
        const match = line.match(/\s+(@rpath\/libnode\.\d+\.dylib)\s+/);
        if (match) {
          const libName = path.basename(match[1]);
          // Try to find the lib on the system
          const libPath = execSync(`find /opt/homebrew /usr/local -name "${libName}" 2>/dev/null | head -n 1`).toString().trim();
          if (libPath && await pathExists(libPath)) {
            console.log(`Bundling dynamic dependency: ${libName}`);
            await fsp.copyFile(libPath, path.join(runtimeDir, libName));
          }
        }
      }
    } catch (e) {
      console.warn("Failed to bundle dynamic dependencies:", e.message);
    }
  }

  await build({
    entryPoints: [serverEntrySource],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: path.join(runtimeDir, bundleFileName),
    external: ["better-sqlite3", "pino", "pino-http", "pino-pretty"],
    minify: true,
    sourcemap: false,
  });

  const runtimePackageJson = {
    name: "workhorse-sidecar-runtime",
    private: true,
    dependencies: runtimeDependencies,
  };

  await fsp.writeFile(
    path.join(runtimeDir, "package.json"),
    `${JSON.stringify(runtimePackageJson, null, 2)}\n`,
    "utf8"
  );

  const launcherPath = path.join(
    runtimeDir,
    isWindows ? "workhorse-server.cmd" : "workhorse-server"
  );
  const wrapperScript = isWindows
    ? `@echo off
setlocal
if "%PORT%"=="" set PORT=12621
if "%NODE_ENV%"=="" set NODE_ENV=production
if "%WORKHORSE_VERSION%"=="" set WORKHORSE_VERSION=${rootPackage.version}
set DIR=%~dp0
cd /d "%DIR%"
"%DIR%${runtimeNodeFileName}" "%DIR%${bundleFileName}" %*
`
    : `#!/bin/bash
set -euo pipefail
DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
export PORT="\${PORT:-12621}"
export NODE_ENV="\${NODE_ENV:-production}"
export WORKHORSE_VERSION="\${WORKHORSE_VERSION:-${rootPackage.version}}"
cd "$DIR"
exec "$DIR/${runtimeNodeFileName}" "$DIR/${bundleFileName}" "$@"
`;

  await fsp.writeFile(launcherPath, wrapperScript, "utf8");
  if (!isWindows) {
    await fsp.chmod(launcherPath, 0o755);
    await fsp.chmod(runtimeNodePath, 0o755);
  }

  await runCommand(
    runtimeNodeSource,
    [
      npmCliPath,
      "install",
      "--omit=dev",
      "--no-package-lock",
      "--audit=false",
      "--fund=false",
      "--prefix",
      runtimeDir,
    ],
    {
      cwd: repoRoot,
    }
  );

  const betterSqliteDir = path.join(runtimeDir, "node_modules", "better-sqlite3");
  await fsp.rm(path.join(betterSqliteDir, "build"), { recursive: true, force: true });
  await runCommand(runtimeNodeSource, [nodeGypPath, "rebuild", "--release"], {
    cwd: betterSqliteDir,
  });

  const betterSqliteBinary = path.join(betterSqliteDir, "build", "Release", "better_sqlite3.node");

  await pruneRuntimeFiles();
  await stripBinary(betterSqliteBinary);
  await ensureExecutableSignature(runtimeNodePath);

  await runCommand(
    runtimeNodeSource,
    [
      "-e",
      [
        "const Database = require('better-sqlite3');",
        "new Database(':memory:').prepare('select 1').get();",
        "console.log('sidecar runtime verified');",
      ].join(" "),
    ],
    {
      cwd: runtimeDir,
    }
  );

  console.log(`Built sidecar runtime at ${runtimeDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
