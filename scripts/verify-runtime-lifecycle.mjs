import { execFileSync, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const ports = [12620, 12621];

function isPortOpen(port) {
  try {
    const output = execFileSync("lsof", ["-ti", `tcp:${port}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim().length > 0;
  } catch (error) {
    if (error.status === 1) {
      return false;
    }
    throw error;
  }
}

async function waitForPorts(expectedOpen, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const states = ports.map((port) => isPortOpen(port));
    if (states.every((state) => state === expectedOpen)) {
      return;
    }
    await sleep(500);
  }

  const snapshot = ports
    .map((port) => `${port}:${isPortOpen(port) ? "open" : "closed"}`)
    .join(", ");
  throw new Error(`${label} timed out; current ports => ${snapshot}`);
}

function runNpm(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd: repoRoot,
      env: process.env,
      shell: process.platform === "win32",
      ...options,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ child, stdout, stderr });
        return;
      }
      reject(
        new Error(
          `npm ${args.join(" ")} exited with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`
        )
      );
    });
  });
}

async function main() {
  await runNpm(["run", "stop"]);
  await waitForPorts(false, 10_000, "initial stop");

  const devProcess = spawn("npm", ["run", "dev"], {
    cwd: repoRoot,
    env: process.env,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  let devStdout = "";
  let devStderr = "";
  devProcess.stdout?.on("data", (chunk) => {
    devStdout += chunk.toString();
  });
  devProcess.stderr?.on("data", (chunk) => {
    devStderr += chunk.toString();
  });

  try {
    await waitForPorts(true, 45_000, "dev startup");
    await runNpm(["run", "stop"]);
    await waitForPorts(false, 15_000, "dev shutdown");
  } catch (error) {
    devProcess.kill("SIGTERM");
    throw new Error(
      `${error.message}\n\nCaptured dev stdout:\n${devStdout}\nCaptured dev stderr:\n${devStderr}`
    );
  }

  if (!devProcess.killed) {
    devProcess.kill("SIGTERM");
  }

  console.log("runtime lifecycle verified: ports 12620 and 12621 open and close correctly");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
