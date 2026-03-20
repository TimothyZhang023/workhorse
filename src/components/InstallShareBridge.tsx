import { useEffect } from "react";
import { App } from "antd";
import { useNavigate } from "react-router-dom";
import { importInstallShare } from "@/services/api";
import { inferInstallRoute, parseInstallShareUrl } from "@/utils/installShare";

export function InstallShareBridge() {
  const navigate = useNavigate();
  const { message } = App.useApp();

  useEffect(() => {
    if (typeof window === "undefined" || window.location.protocol !== "tauri:") {
      return undefined;
    }

    const handledBundles = new Set<string>();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const installFromUrls = async (urls: string[] = []) => {
      for (const rawUrl of urls) {
        const parsed = parseInstallShareUrl(rawUrl);
        if (!parsed || handledBundles.has(parsed.bundle)) {
          continue;
        }

        handledBundles.add(parsed.bundle);

        try {
          const result = await importInstallShare(parsed.bundle);
          if (disposed) {
            return;
          }

          const targetPath = inferInstallRoute(result.kind);
          navigate(targetPath);
          window.dispatchEvent(
            new CustomEvent("workhorse:install-share-imported", {
              detail: result,
            })
          );
          message.success(
            result.kind === "mcp"
              ? result.status === "created"
                ? `已通过安装链接导入 MCP：${result.server.name}`
                : `MCP 已存在：${result.server.name}`
              : result.status === "created"
                ? `已通过安装链接导入 Skill：${result.skill.name}`
                : `Skill 已存在：${result.skill.name}`
          );
        } catch (error: any) {
          message.error(error?.message || "安装链接处理失败");
        }
      }
    };

    (async () => {
      try {
        const plugin = await import("@tauri-apps/plugin-deep-link");
        const currentUrls = await plugin.getCurrent();
        if (Array.isArray(currentUrls) && currentUrls.length) {
          await installFromUrls(currentUrls);
        }
        unlisten = await plugin.onOpenUrl((urls) => {
          void installFromUrls(urls);
        });
      } catch {
        // Deep link plugin is only available in desktop runtime.
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [message, navigate]);

  return null;
}
