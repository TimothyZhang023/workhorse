import { Sidebar } from "@/components/Sidebar";
import { useShellPreferences } from "@/hooks/useShellPreferences";
import {
  getGlobalSystemPromptSetting,
  updateGlobalSystemPromptSetting,
} from "@/services/api";
import { useAppStore } from "@/stores/useAppStore";
import {
  Button,
  Card,
  ConfigProvider,
  Input,
  Space,
  Typography,
  message as antdMessage,
  theme as antdTheme,
} from "antd";
import { useEffect, useState } from "react";
import "../Dashboard/index.css";

const { TextArea } = Input;

export default function SystemSettingsPage() {
  const { isLoggedIn } = useAppStore();
  const [messageApi, contextHolder] = antdMessage.useMessage();
  const {
    moduleExpanded,
    setModuleExpanded,
    themeMode,
    resolvedTheme,
    setThemeMode,
    isDark,
  } = useShellPreferences();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [markdown, setMarkdown] = useState("");

  const loadSettings = async () => {
    setLoading(true);
    try {
      const result = await getGlobalSystemPromptSetting();
      setMarkdown(String(result.markdown || ""));
    } catch (error: any) {
      messageApi.error(error.message || "加载全局系统配置失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    loadSettings();
  }, [isLoggedIn]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateGlobalSystemPromptSetting(markdown);
      messageApi.success("全局系统配置已保存");
    } catch (error: any) {
      messageApi.error(error.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (!isLoggedIn) return null;

  return (
    <ConfigProvider
      wave={{ disabled: true }}
      theme={{
        algorithm: isDark
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm,
        token: { motion: false },
      }}
    >
      {contextHolder}
      <div className={`cw-dashboard-layout ${isDark ? "dark" : ""}`}>
        <Sidebar
          moduleExpanded={moduleExpanded}
          setModuleExpanded={setModuleExpanded}
          themeMode={themeMode}
          resolvedTheme={resolvedTheme}
          setThemeMode={setThemeMode}
          activePath="/settings/system"
        />
        <main className="cw-dashboard-main-wrap">
          <div
            style={{
              display: "grid",
              gap: 20,
            }}
          >
            <div>
              <Typography.Title level={2} style={{ marginBottom: 8 }}>
                全局系统配置
              </Typography.Title>
              <Typography.Paragraph style={{ marginBottom: 0, color: "var(--text-secondary)" }}>
                这里定义所有会话和 Agent 默认继承的全局 System Prompt。
                对话页不再单独编辑 System Prompt，避免配置分散。
              </Typography.Paragraph>
            </div>

            <Card
              style={{
                borderRadius: 20,
                boxShadow: isDark
                  ? "0 18px 48px rgba(0,0,0,0.28)"
                  : "0 18px 48px rgba(15,23,42,0.08)",
              }}
              loading={loading}
            >
              <div style={{ display: "grid", gap: 16 }}>
                <div>
                  <Typography.Text strong>Global System Prompt</Typography.Text>
                  <Typography.Paragraph style={{ margin: "8px 0 0", color: "var(--text-secondary)" }}>
                    支持 Markdown。内容会参与所有会话与任务的静态上下文预算。
                  </Typography.Paragraph>
                </div>
                <TextArea
                  value={markdown}
                  onChange={(event) => setMarkdown(event.target.value)}
                  autoSize={{ minRows: 16, maxRows: 30 }}
                  placeholder="定义你的全局代理原则、边界、风格和默认工作方式。"
                />
                <Space>
                  <Button type="primary" onClick={handleSave} loading={saving}>
                    保存
                  </Button>
                  <Button onClick={loadSettings} disabled={loading || saving}>
                    重新加载
                  </Button>
                </Space>
              </div>
            </Card>
          </div>
        </main>
      </div>
    </ConfigProvider>
  );
}
