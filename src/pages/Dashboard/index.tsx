import { Sidebar } from "@/components/Sidebar";
import { useShellPreferences } from "@/hooks/useShellPreferences";
import {
  ApiOutlined,
  DesktopOutlined,
  InfoCircleOutlined,
  MessageOutlined,
  ReloadOutlined,
  RobotOutlined,
  ScheduleOutlined,
  ThunderboltOutlined,
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
  Progress,
  Row,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  theme as antdTheme,
} from "antd";
import { useEffect, useState } from "react";
import "./index.css";

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
  health?: {
    commands?: Array<{
      name: string;
      installed: boolean;
      version?: string;
      error?: string;
    }>;
    network?: Array<{
      target: string;
      reachable: boolean;
      status?: number;
      error?: string;
    }>;
  };
  context_budget?: {
    context_window: number;
    compact_threshold: number;
    compact_threshold_ratio: number;
    static_tokens: number;
    static_percentage: number;
    remaining_budget: number;
    remaining_percentage: number;
    active_model?: {
      model_id: string;
      display_name: string;
    } | null;
    breakdown: Array<{
      key: string;
      label: string;
      tokens: number;
      percentage_of_window: number;
      content?: string;
    }>;
  };
  recommendations: string[];
};

export default () => {
  const { currentUser, isLoggedIn } = useAppStore();
  const navigate = useNavigate();
  const {
    moduleExpanded,
    setModuleExpanded,
    themeMode,
    resolvedTheme,
    setThemeMode,
    isDark,
  } = useShellPreferences();
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overview, setOverview] = useState<SystemOverviewData | null>(null);
  const [recentRuns, setRecentRuns] = useState<any[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

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

  const loadRecentRuns = async () => {
    setRunsLoading(true);
    try {
      const data = await request<any[]>("/api/agent-tasks/runs?limit=5");
      setRecentRuns(data);
    } catch (error) {
      setRecentRuns([]);
    } finally {
      setRunsLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    loadOverview();
    loadRecentRuns();
  }, [isLoggedIn]);

  if (!isLoggedIn) return null;

  const counts = overview?.counts;
  const runtime = overview?.runtime;
  const commandChecks = overview?.health?.commands || [];
  const networkChecks = overview?.health?.network || [];
  const contextBudget = overview?.context_budget;
  const segmentColors: Record<string, string> = {
    global_prompt: "#2563eb",
    skills: "#f59e0b",
    mcp_tools: "#06b6d4",
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
          themeMode={themeMode}
          resolvedTheme={resolvedTheme}
          setThemeMode={setThemeMode}
          activePath="/dashboard"
        />

        <main className="cw-dashboard-main-wrap">
          <section className="cw-dashboard-hero">
            <div className="cw-hero-content">
              <div className="cw-dashboard-eyebrow">
                <span className="cw-pulse"></span>
                Workbench
              </div>
              <h1>
                欢迎回来，
                <span className="cw-gradient-text">
                  {currentUser?.username || "用户"}
                </span>
              </h1>
              <p>
                workhorse 是你的个人助理 Agent 工作台。在这里，你可以管理
                Agent、调度任务并实时监控系统状态。
              </p>
              <div className="cw-hero-actions">
                <Button
                  type="primary"
                  size="large"
                  icon={<MessageOutlined />}
                  onClick={() => navigate("/agency")}
                >
                  对话
                </Button>
                <Button
                  size="large"
                  icon={<ApiOutlined />}
                  onClick={() => navigate("/mcp")}
                >
                  MCP
                </Button>
                <Button
                  size="large"
                  icon={<ThunderboltOutlined />}
                  onClick={() => navigate("/skills")}
                >
                  技能
                </Button>
                <Button
                  size="large"
                  icon={<RobotOutlined />}
                  onClick={() => navigate("/agent-tasks")}
                >
                  任务
                </Button>
                <Button
                  size="large"
                  icon={<ScheduleOutlined />}
                  onClick={() => navigate("/cron-jobs")}
                >
                  调配
                </Button>
              </div>
            </div>
            <div className="cw-user-card">
              <div className="cw-user-avatar-wrap">
                <Avatar
                  size={64}
                  style={{
                    backgroundColor: "#2563eb",
                    fontSize: 24,
                    boxShadow: "0 8px 16px rgba(37, 99, 235, 0.2)",
                  }}
                >
                  {currentUser?.username?.[0]?.toUpperCase()}
                </Avatar>
                <div className="cw-status-badge"></div>
              </div>
              <div>
                <div className="cw-user-name">{currentUser?.username}</div>
                <div className="cw-user-desc">
                  {currentUser?.role || "本地管理员"}
                </div>
              </div>
            </div>
          </section>

          <section className="cw-dashboard-main">
            <Row gutter={[24, 24]}>
              {/* Row 1: Stats & Health */}
              <Col xs={24} lg={15}>
                <Card className="cw-module-card cw-overview-main-card">
                  <div className="cw-usage-header">
                    <div>
                      <h3>系统概览</h3>
                      <p>当前工作台运行核心统计</p>
                    </div>
                    <div className="cw-usage-actions">
                      <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={loadOverview}
                        loading={overviewLoading}
                        type="text"
                      />
                    </div>
                  </div>
                  {overviewLoading ? (
                    <div className="cw-usage-loading">
                      <Spin />
                    </div>
                  ) : !counts ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <>
                      <div className="cw-stats-grid">
                        <div className="cw-stat-card">
                          <RobotOutlined className="cw-stat-icon task" />
                          <div className="cw-stat-info">
                            <div className="cw-stat-label">任务数量</div>
                            <div className="cw-stat-value">
                              {counts.tasks?.toLocaleString() || 0}
                            </div>
                          </div>
                        </div>
                        <div className="cw-stat-card">
                          <ThunderboltOutlined className="cw-stat-icon skill" />
                          <div className="cw-stat-info">
                            <div className="cw-stat-label">已备技能</div>
                            <div className="cw-stat-value">
                              {counts.skills?.toLocaleString() || 0}
                            </div>
                          </div>
                        </div>
                        <div className="cw-stat-card">
                          <DesktopOutlined className="cw-stat-icon mcp" />
                          <div className="cw-stat-info">
                            <div className="cw-stat-label">MCP 工具</div>
                            <div className="cw-stat-value">
                              {counts.mcp_servers || 0}
                            </div>
                          </div>
                        </div>
                        <div className="cw-stat-card">
                          <ScheduleOutlined className="cw-stat-icon cron" />
                          <div className="cw-stat-info">
                            <div className="cw-stat-label">定时调度</div>
                            <div className="cw-stat-value">
                              {counts.cron_jobs || 0}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="cw-runtime-bar">
                        <div className="cw-runtime-item">
                          <Typography.Text type="secondary">
                            环境版本
                          </Typography.Text>
                          <Typography.Text strong>
                            Node {runtime?.node || "-"}
                          </Typography.Text>
                        </div>
                        <div className="cw-runtime-item">
                          <Typography.Text type="secondary">
                            运行平台
                          </Typography.Text>
                          <Typography.Text strong>
                            {runtime?.platform || "-"}
                          </Typography.Text>
                        </div>
                        <div className="cw-runtime-item">
                          <Typography.Text type="secondary">
                            持续运行时长
                          </Typography.Text>
                          <Typography.Text strong>
                            {runtime
                              ? `${Math.floor(runtime.uptime_seconds / 60)} 分钟`
                              : "-"}
                          </Typography.Text>
                        </div>
                      </div>

                    </>
                  )}
                </Card>
              </Col>

              <Col xs={24} lg={9}>
                <Card className="cw-module-card cw-health-card">
                  <div className="cw-usage-header">
                    <div>
                      <h3>环境检查</h3>
                      <p>核心运行时与命令状态</p>
                    </div>
                  </div>
                  {overviewLoading && !overview ? (
                    <div className="cw-usage-loading">
                      <Spin />
                    </div>
                  ) : (
                    <div className="cw-health-grid">
                      {commandChecks.map((item) => (
                        <div key={item.name} className="cw-health-row">
                          <div className="cw-health-info">
                            <div className="cw-health-name">{item.name}</div>
                            <div className="cw-health-ver">
                              {item.installed
                                ? item.version || "ok"
                                : item.error || "missing"}
                            </div>
                          </div>
                          <Tag
                            color={item.installed ? "success" : "error"}
                            bordered={false}
                          >
                            {item.installed ? "正常" : "异常"}
                          </Tag>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </Col>

              {/* Row 2: Budget & Network */}
              <Col xs={24} lg={18}>
                <Card className="cw-module-card cw-context-budget-card">
                  <div className="cw-usage-header">
                    <div>
                      <h3>上下文预算 (75% 负载建议)</h3>
                      <p>Token 占用实时分析，保障 Agent 长程记忆</p>
                    </div>
                    {contextBudget?.active_model && (
                      <Tag
                        color="blue"
                        bordered={false}
                        style={{ padding: "4px 12px" }}
                      >
                        {contextBudget.active_model.display_name ||
                          contextBudget.active_model.model_id}
                      </Tag>
                    )}
                  </div>

                  {!contextBudget ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <Space
                      direction="vertical"
                      size={24}
                      style={{ width: "100%" }}
                    >
                      <div className="cw-stats-grid mini">
                        {[
                          {
                            label: "窗口上限",
                            value: `${Math.round(
                              contextBudget.context_window / 1024
                            )}k`,
                          },
                          {
                            label: "压缩阈值",
                            value: `${Math.round(
                              contextBudget.compact_threshold / 1024
                            )}k`,
                          },
                          {
                            label: "静态占比",
                            value: `${contextBudget.static_percentage}%`,
                          },
                          {
                            label: "剩余空间",
                            value: `${contextBudget.remaining_percentage}%`,
                          },
                        ].map((s) => (
                          <div key={s.label} className="cw-stat-card mini">
                            <div className="cw-stat-label">{s.label}</div>
                            <div className="cw-stat-value">{s.value}</div>
                          </div>
                        ))}
                      </div>

                      <div className="cw-progress-wrap">
                        <div className="cw-progress-labels">
                          <span>静态上下文占用</span>
                          <span>{contextBudget.static_percentage}%</span>
                        </div>
                        <Progress
                          percent={contextBudget.static_percentage}
                          showInfo={false}
                          strokeColor={{ "0%": "#2563eb", "100%": "#7c3aed" }}
                          trailColor={isDark ? "#1e293b" : "#f1f5f9"}
                          strokeWidth={10}
                        />
                      </div>

                      <Row gutter={[12, 12]}>
                        {contextBudget.breakdown.map((item) => (
                          <Col key={item.key} xs={24} sm={8}>
                            <Tooltip
                              title={
                                <div
                                  style={{
                                    maxHeight: 250,
                                    overflow: "auto",
                                    padding: 8,
                                  }}
                                >
                                  <pre
                                    style={{
                                      margin: 0,
                                      whiteSpace: "pre-wrap",
                                      fontSize: 11,
                                    }}
                                  >
                                    {item.content || "暂无内容"}
                                  </pre>
                                </div>
                              }
                              placement="top"
                              overlayStyle={{ maxWidth: 450 }}
                            >
                              <div className="cw-segment-card">
                                <div className="cw-segment-header">
                                  <span className="cw-segment-label">
                                    {item.label}
                                  </span>
                                  <span className="cw-segment-val">
                                    {item.tokens} t
                                  </span>
                                </div>
                                <Progress
                                  percent={item.percentage_of_window}
                                  size="small"
                                  strokeColor={
                                    segmentColors[item.key] || "#64748b"
                                  }
                                  showInfo={false}
                                />
                              </div>
                            </Tooltip>
                          </Col>
                        ))}
                      </Row>
                    </Space>
                  )}
                </Card>
              </Col>

              <Col xs={24} lg={6}>
                <Card className="cw-module-card cw-network-card">
                  <div className="cw-usage-header">
                    <div>
                      <h3>网络状态</h3>
                      <p>后端服务连通性</p>
                    </div>
                  </div>
                  <div className="cw-health-grid">
                    {networkChecks.map((item) => (
                      <div key={item.target} className="cw-health-row compact">
                        <div className="cw-health-info">
                          <div
                            className="cw-health-name"
                            style={{ fontSize: 13 }}
                          >
                            {item.target}
                          </div>
                          <div className="cw-health-ver">
                            {item.reachable ? `HTTP ${item.status}` : "Error"}
                          </div>
                        </div>
                        <div
                          className={`cw-status-indicator ${item.reachable ? "online" : "offline"
                            }`}
                        ></div>
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>

              {/* Row 3: Activity & Quick Links */}
              <Col xs={24} lg={16}>
                <Card className="cw-module-card cw-activity-large-card">
                  <div className="cw-usage-header">
                    <div>
                      <h3>最近活动记录</h3>
                      <p>追踪 Agent 执行轨迹与结果</p>
                    </div>
                    <Button
                      type="link"
                      onClick={() => navigate("/agent-tasks")}
                    >
                      查看全部
                    </Button>
                  </div>
                  {runsLoading ? (
                    <div className="cw-usage-loading">
                      <Spin size="small" />
                    </div>
                  ) : recentRuns.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="近期无活动"
                    />
                  ) : (
                    <div className="cw-run-list">
                      {recentRuns.map((run) => (
                        <div key={run.id} className="cw-run-item">
                          <div className="cw-run-status">
                            <span
                              className={`cw-status-dot ${run.status}`}
                            ></span>
                          </div>
                          <div className="cw-run-info">
                            <div className="cw-run-title">
                              {run.task_name || `Runnable #${run.task_id}`}
                            </div>
                            <div className="cw-run-time">
                              {new Date(run.created_at).toLocaleString()}
                            </div>
                          </div>
                          <Tag
                            color={
                              run.status === "success"
                                ? "success"
                                : run.status === "running"
                                  ? "processing"
                                  : "error"
                            }
                          >
                            {run.status === "success"
                              ? "已完成"
                              : run.status === "running"
                                ? "运行中"
                                : "失败"}
                          </Tag>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </Col>

              <Col xs={24} lg={8}>
                <Card className="cw-module-card">
                  <div className="cw-usage-header">
                    <div>
                      <h3>快速跳转</h3>
                      <p>常用功能入口</p>
                    </div>
                  </div>
                  <div className="cw-quick-links">
                    <div
                      className="cw-quick-link-item"
                      onClick={() => navigate("/agency")}
                    >
                      <MessageOutlined />
                      <span>对话助手</span>
                    </div>
                    <div
                      className="cw-quick-link-item"
                      onClick={() => navigate("/mcp")}
                    >
                      <ApiOutlined />
                      <span>MCP 管理</span>
                    </div>
                    <div
                      className="cw-quick-link-item"
                      onClick={() => navigate("/cron-jobs")}
                    >
                      <ScheduleOutlined />
                      <span>调度中心</span>
                    </div>
                  </div>
                </Card>
              </Col>
            </Row>
          </section>
        </main>
      </div>
    </ConfigProvider>
  );
};
