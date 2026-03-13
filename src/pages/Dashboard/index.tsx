import { Sidebar } from "@/components/Sidebar";
import {
  ApiOutlined,
  MessageOutlined,
  ReloadOutlined,
  ScheduleOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/useAppStore";
import { request } from "@/services/request";
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

type SystemOverviewData = {
  runtime: {
    node: string;
    platform: string;
    uptime_seconds: number;
  };
  counts: {
    tasks: number;
    skills: number;
    channels: number;
    channels_enabled: number;
    cron_jobs: number;
    mcp_servers: number;
    mcp_enabled: number;
  };
  recommendations: string[];
};

export default () => {
  const { currentUser, isLoggedIn } = useAppStore();
  const navigate = useNavigate();
  const [moduleExpanded, setModuleExpanded] = useState<boolean>(() =>
    getStoredBool("cw.module.expanded", true)
  );
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved =
      localStorage.getItem("cw-theme") || localStorage.getItem("timo-theme");
    if (saved === "dark" || saved === "light") return saved;
    return "light";
  });
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overview, setOverview] = useState<SystemOverviewData | null>(null);

  const themeMode = useMemo<"light" | "dark">(() => theme, [theme]);

  useEffect(() => {
    localStorage.setItem("cw.module.expanded", String(moduleExpanded));
  }, [moduleExpanded]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cw-theme", theme);
  }, [theme]);

  const loadOverview = async () => {
    setOverviewLoading(true);
    try {
      const data = await request<SystemOverviewData>("/api/system/overview");
      setOverview(data);
    } catch (error) {
      setOverview(null);
    } finally {
      setOverviewLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    loadOverview();
  }, [isLoggedIn]);

  if (!isLoggedIn) return null;

  const isDark = themeMode === "dark";
  const counts = overview?.counts;
  const runtime = overview?.runtime;

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
        />

        <main className="cw-dashboard-main-wrap">
          <section className="cw-dashboard-hero">
            <div>
              <div className="cw-dashboard-eyebrow">Dashboard</div>
              <h1>欢迎回来，{currentUser?.username || "CW 用户"}</h1>
              <p>
                cowhouse 是你的个人助理 Agent 工作台，当前聚合了对话、工具、
                任务与调度能力。
              </p>
            </div>
            <div className="cw-user-card">
              <Avatar size={48} style={{ backgroundColor: "#2563eb" }}>
                {currentUser?.username?.[0]?.toUpperCase()}
              </Avatar>
              <div>
                <div className="cw-user-name">{currentUser?.username}</div>
                <div className="cw-user-desc">当前本地账号</div>
              </div>
            </div>
          </section>

          <section className="cw-dashboard-main">
            <Row gutter={[16, 16]}>
              <Col xs={24}>
                <Card className="cw-module-card">
                  <div className="cw-usage-header">
                    <div>
                      <h3>系统概览</h3>
                      <p>当前本地工作台运行状态</p>
                    </div>
                    <div className="cw-usage-actions">
                      <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={loadOverview}
                        loading={overviewLoading}
                      />
                    </div>
                  </div>
                  {overviewLoading ? (
                    <div className="cw-usage-loading">
                      <Spin size="small" />
                    </div>
                  ) : !counts ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="暂无系统数据"
                    />
                  ) : (
                    <>
                      <div className="cw-usage-grid">
                        <div className="cw-usage-item">
                          <div className="cw-usage-label">任务数</div>
                          <div className="cw-usage-value">
                            {counts.tasks?.toLocaleString() ?? "0"}
                          </div>
                        </div>
                        <div className="cw-usage-item">
                          <div className="cw-usage-label">技能数</div>
                          <div className="cw-usage-value">
                            {counts.skills?.toLocaleString() ?? "0"}
                          </div>
                        </div>
                        <div className="cw-usage-item">
                          <div className="cw-usage-label">MCP 服务</div>
                          <div className="cw-usage-value">
                            {counts.mcp_servers ?? 0}
                          </div>
                        </div>
                        <div className="cw-usage-item">
                          <div className="cw-usage-label">Cron 任务</div>
                          <div className="cw-usage-value">
                            {counts.cron_jobs ?? 0}
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          marginTop: 16,
                          color: isDark ? "#cbd5e1" : "#475569",
                        }}
                      >
                        <div>
                          运行环境：Node {runtime?.node || "-"} /{" "}
                          {runtime?.platform || "-"}
                        </div>
                        <div>
                          已运行：
                          {runtime
                            ? `${Math.floor(runtime.uptime_seconds / 60)} 分钟`
                            : "-"}
                        </div>
                        {(overview?.recommendations || []).length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            {(overview?.recommendations || []).map((item) => (
                              <div key={item}>{item}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </Card>
              </Col>

              <Col xs={24} md={8}>
                <Card
                  className="cw-module-card"
                  hoverable
                  onClick={() => navigate("/chat")}
                >
                  <MessageOutlined className="cw-module-icon" />
                  <h3>对话</h3>
                  <p>多模型流式对话、会话管理和 System Prompt 配置入口。</p>
                </Card>
              </Col>

              <Col xs={24} md={8}>
                <Card
                  className="cw-module-card"
                  hoverable
                  onClick={() => navigate("/mcp")}
                >
                  <ApiOutlined className="cw-module-icon" />
                  <h3>MCP 管理</h3>
                  <p>查看已接入的工具服务，并继续扩展 Agent 能力边界。</p>
                </Card>
              </Col>

              <Col xs={24} md={8}>
                <Card
                  className="cw-module-card"
                  hoverable
                  onClick={() => navigate("/cron-jobs")}
                >
                  <ScheduleOutlined className="cw-module-icon" />
                  <h3>调度中心</h3>
                  <p>把任务变成周期执行的自动化工作流，并跟踪运行状态。</p>
                </Card>
              </Col>
            </Row>
          </section>
        </main>
      </div>
    </ConfigProvider>
  );
};
