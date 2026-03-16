import { spawn } from "node:child_process";
import process from "node:process";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
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

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function main() {
  const env = {
    ...process.env,
    WORKHORSE_NODE_BIN: process.execPath,
  };

  // 1. Clean up ports and ensure sidecar build
  await run(npmCommand, ["run", "stop"], { env });
  
  // 2. Build sidecar runtime
  console.log("Building sidecar runtime...");
  await run(process.execPath, ["scripts/build-sidecar.mjs"], { env });
  
  // 3. Build tauri app
  console.log("Building tauri app...");
  await run(npmCommand, ["run", "tauri", "--", "build"], { env });
  
  // 4. Build custom DMG
  console.log("Building custom DMG...");
  await run(process.execPath, ["scripts/build-dmg.mjs"], { env });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
