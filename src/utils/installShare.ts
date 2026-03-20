export function parseInstallShareUrl(rawUrl: string) {
  try {
    const url = new URL(String(rawUrl || ""));
    if (url.protocol !== "workhorse:") {
      return null;
    }

    const bundle = String(url.searchParams.get("bundle") || "").trim();
    if (!bundle) {
      return null;
    }

    return {
      bundle,
      pathname: url.pathname,
    };
  } catch {
    return null;
  }
}

export function inferInstallRoute(kind: "mcp" | "skill") {
  return kind === "mcp" ? "/mcp" : "/skills";
}

export function guessPrimaryCommand(commands: API.InstallShare["commands"]) {
  if (typeof navigator !== "undefined") {
    const platform = String(navigator.platform || "").toLowerCase();
    if (platform.includes("mac")) {
      return commands.macos;
    }
    if (platform.includes("win")) {
      return commands.windows;
    }
  }

  return commands.linux;
}
