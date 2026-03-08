import { AccountModal } from "@/components/AccountModal";
import { SettingsModal } from "@/components/SettingsModal";
import { Sidebar } from "@/components/Sidebar";
import {
  BarChartOutlined,
  MessageOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { history, request, useModel } from "@umijs/max";
import {
  Avatar,
  Button,
  Card,
  Col,
  ConfigProvider,
  Empty,
  Row,
  Spin,
  theme as antdTheme,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import "./index.css";

const getStoredBool = (key: string, fallback: boolean): boolean => {
  const value = localStorage.getItem(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
};

type UsageSummaryData = {
  totals: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_requests: number;
    models_used: number;
    active_days: number;
  };
  byModel: Array<{ model: string; total_tokens: number; requests: number }>;
  daily: Array<{
    date: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    requests: number;
  }>;
};

export default () => {
  const { currentUser, isLoggedIn, logout } = useModel("global");
  const [moduleExpanded, setModuleExpanded] = useState<boolean>(() =>
    getStoredBool("cw.module.expanded", true)
  );
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved =
      localStorage.getItem("cw-theme") || localStorage.getItem("timo-theme");
    if (saved === "dark" || saved === "light") return saved;
    return "light";
  });
  const [showAccount, setShowAccount] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [usageDays, setUsageDays] = useState<number>(30);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usage, setUsage] = useState<UsageSummaryData | null>(null);

  const themeMode = useMemo<"light" | "dark">(() => {
    return theme;
  }, [theme]);

  useEffect(() => {
    if (!isLoggedIn) history.replace("/login");
  }, [isLoggedIn]);

  useEffect(() => {
    localStorage.setItem("cw.module.expanded", String(moduleExpanded));
  }, [moduleExpanded]);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cw-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!isLoggedIn) return;
    loadUsage();
  }, [isLoggedIn, usageDays]);

  if (!isLoggedIn) return null;

  const isDark = themeMode === "dark";
  const totals = usage?.totals;

  const loadUsage = async () => {
    setUsageLoading(true);
    try {
      const data = await request<UsageSummaryData>(
        `/api/account/summary?days=${usageDays}`
      );
      setUsage(data);
    } catch (error) {
      setUsage(null);
    } finally {
      setUsageLoading(false);
    }
  };

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
      <div className={`cw-dashboard-layout ${isDark ? "dark" : ""}`}>
        <Sidebar
          moduleExpanded={moduleExpanded}
          setModuleExpanded={setModuleExpanded}
          theme={theme}
          setTheme={setTheme}
          activePath="/dashboard"
          setShowAccount={setShowAccount}
          setShowSettings={setShowSettings}
        />

        <main className="cw-dashboard-main-wrap">
          <section className="cw-dashboard-hero">
            <div>
              <div className="cw-dashboard-eyebrow">Dashboard</div>
              <h1>欢迎回来，{currentUser?.username || "CW 用户"}</h1>
              <p>
                cowhouse 是你的个人助理 Agent
                工作台，当前已启用对话模块、统一模型接入和用量统计。
              </p>
            </div>
            <div className="cw-user-card">
              <Avatar size={48} style={{ backgroundColor: "#2563eb" }}>
                {currentUser?.username?.[0]?.toUpperCase()}
              </Avatar>
              <div>
                <div className="cw-user-name">{currentUser?.username}</div>
                <div className="cw-user-desc">当前登录账号</div>
              </div>
            </div>
          </section>

          <section className="cw-dashboard-main">
            <Row gutter={[16, 16]}>
              <Col xs={24}>
                <Card className="cw-module-card">
                  <div className="cw-usage-header">
                    <div>
                      <h3>用量统计</h3>
                      <p>最近 {usageDays} 天</p>
                    </div>
                    <div className="cw-usage-actions">
                      <Button
                        size="small"
                        type={usageDays === 7 ? "primary" : "default"}
                        onClick={() => setUsageDays(7)}
                      >
                        7天
                      </Button>
                      <Button
                        size="small"
                        type={usageDays === 30 ? "primary" : "default"}
                        onClick={() => setUsageDays(30)}
                      >
                        30天
                      </Button>
                      <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={loadUsage}
                        loading={usageLoading}
                      />
                    </div>
                  </div>
                  {usageLoading ? (
                    <div className="cw-usage-loading">
                      <Spin size="small" />
                    </div>
                  ) : !totals ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="暂无统计数据"
                    />
                  ) : (
                    <div className="cw-usage-grid">
                      <div className="cw-usage-item">
                        <div className="cw-usage-label">总请求数</div>
                        <div className="cw-usage-value">
                          {totals.total_requests?.toLocaleString() ?? "0"}
                        </div>
                      </div>
                      <div className="cw-usage-item">
                        <div className="cw-usage-label">总 Token</div>
                        <div className="cw-usage-value">
                          {totals.total_tokens?.toLocaleString() ?? "0"}
                        </div>
                      </div>
                      <div className="cw-usage-item">
                        <div className="cw-usage-label">使用模型数</div>
                        <div className="cw-usage-value">
                          {totals.models_used ?? 0}
                        </div>
                      </div>
                      <div className="cw-usage-item">
                        <div className="cw-usage-label">活跃天数</div>
                        <div className="cw-usage-value">
                          {totals.active_days ?? 0}
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              </Col>

              <Col xs={24} md={12}>
                <Card
                  className="cw-module-card"
                  hoverable
                  onClick={() => history.push("/chat")}
                >
                  <MessageOutlined className="cw-module-icon" />
                  <h3>对话</h3>
                  <p>
                    多模型流式对话、会话管理、System Prompt 和模型切换都在这里。
                  </p>
                </Card>
              </Col>

              <Col xs={24} md={12}>
                <Card className="cw-module-card">
                  <BarChartOutlined className="cw-module-icon" />
                  <h3>更多模块</h3>
                  <p>
                    后续扩展知识库、任务流和工具编排等能力，统一收敛在 CW
                    工作台。
                  </p>
                </Card>
              </Col>
            </Row>
          </section>
        </main>
        <SettingsModal open={showSettings} onOpenChange={setShowSettings} />
        <AccountModal
          open={showAccount}
          onClose={() => setShowAccount(false)}
          isDark={theme === "dark"}
        />
      </div>
    </ConfigProvider>
  );
};
