import { Sidebar } from "@/components/Sidebar";
import { useShellPreferences } from "@/hooks/useShellPreferences";
import {
  createCronJob,
  deleteCronJob,
  getAgentTasks,
  getCronJobs,
  getCronRunHistory,
  updateCronJob,
} from "@/services/api";
import {
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
  ScheduleOutlined,
} from "@ant-design/icons";
import {
  ModalForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProList,
} from "@ant-design/pro-components";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/useAppStore";
import {
  theme as antdTheme,
  Button,
  Card,
  ConfigProvider,
  Empty,
  message,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import "../Dashboard/index.css";

const formatRunStatus = (status?: string) => {
  if (status === "success") return <Tag color="success">成功</Tag>;
  if (status === "running") return <Tag color="processing">运行中</Tag>;
  if (status === "failed") return <Tag color="error">失败</Tag>;
  return <Tag>{status || "未知"}</Tag>;
};

const parseTimestamp = (value?: string) => {
  if (!value) return Number.NaN;
  const normalized =
    typeof value === "string" &&
    !/[zZ]|[+-]\d{2}:\d{2}$/.test(value) &&
    value.includes(" ")
      ? `${value.replace(" ", "T")}Z`
      : value;
  return Date.parse(normalized);
};

const formatDateTime = (value?: string) => {
  if (!value) return "-";
  const timestamp = parseTimestamp(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
};

const formatDuration = (startedAt?: string, finishedAt?: string) => {
  if (!startedAt || !finishedAt) return "进行中";
  const duration = parseTimestamp(finishedAt) - parseTimestamp(startedAt);
  if (!Number.isFinite(duration) || duration < 0) return "-";
  if (duration < 1000) return `${duration}ms`;

  const seconds = duration / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainSeconds}s`;
};

export default () => {
  const { currentUser, isLoggedIn } = useAppStore();
  const navigate = useNavigate();
  const [messageApi, messageContextHolder] = message.useMessage();
  const {
    moduleExpanded,
    setModuleExpanded,
    themeMode,
    resolvedTheme,
    setThemeMode,
    isDark,
  } = useShellPreferences();
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<API.CronJob[]>([]);
  const [tasks, setTasks] = useState<API.AgentTask[]>([]);
  const [editingJob, setEditingJob] = useState<Partial<API.CronJob> | null>(
    null
  );
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [cronHistory, setCronHistory] = useState<API.TaskRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyCronJobId, setHistoryCronJobId] = useState<number | undefined>(
    undefined
  );

  const loadData = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const [j, t] = await Promise.all([getCronJobs(), getAgentTasks()]);
      setJobs(j);
      setTasks(t);
      setLastRefreshedAt(new Date().toISOString());
    } catch (e) {
      if (!silent) {
        messageApi.error("加载数据失败");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadData();
    loadHistory();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        loadData(true);
        loadHistory(true);
      }
    }, 10000);

    return () => window.clearInterval(timer);
  }, []);

  const loadHistory = async (silent = false, cronJobId = historyCronJobId) => {
    if (!silent) {
      setHistoryLoading(true);
    }
    try {
      const runs = await getCronRunHistory(cronJobId, 30);
      setCronHistory(runs);
    } catch (error) {
      if (!silent) {
        messageApi.error("加载 Cron 执行历史失败");
      }
    } finally {
      if (!silent) {
        setHistoryLoading(false);
      }
    }
  };

  const renderStatusTag = (status?: string) => {
    if (!status) return null;
    if (status === "success") {
      return <Tag color="success">success</Tag>;
    }
    if (status === "running") {
      return <Tag color="processing">running</Tag>;
    }
    if (status === "failed") {
      return <Tag color="error">failed</Tag>;
    }
    return <Tag>{status}</Tag>;
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
      {messageContextHolder}
      <div className={`cw-dashboard-layout ${isDark ? "dark" : ""}`}>
        <Sidebar
          moduleExpanded={moduleExpanded}
          setModuleExpanded={setModuleExpanded}
          themeMode={themeMode}
          resolvedTheme={resolvedTheme}
          setThemeMode={setThemeMode}
          activePath="/cron-jobs"
        />

        <main className="cw-dashboard-main-wrap">
          <section className="cw-dashboard-hero">
            <div className="cw-hero-content">
              <div className="cw-dashboard-eyebrow">
                <span className="cw-pulse"></span>
                Automation & Scheduling
              </div>
              <h1>定时调度</h1>
              <p>
                自动化 Agent 执行计划。通过 Cron 表达式预设周期性任务，实现 24/7 全天候无缝监控与处理。
                让 Agent 成为你的数字雇员，在后台默默完成复杂工作。
              </p>
            </div>
            <div className="cw-user-card" style={{ padding: '24px 32px' }}>
              <div className="cw-user-avatar-wrap">
                <div style={{ 
                  width: 48, 
                  height: 48, 
                  background: 'linear-gradient(135deg, #10b981, #34d399)', 
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff'
                }}>
                  <ScheduleOutlined style={{ fontSize: 24 }} />
                </div>
              </div>
              <div>
                <div className="cw-user-name" style={{ fontSize: 18 }}>{jobs.length} 个调度</div>
                <div className="cw-user-desc">自动运行中</div>
              </div>
            </div>
          </section>

          <section className="cw-dashboard-main">
            <Card className="cw-module-card">
              <div
                style={{
                  marginBottom: 16,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <Space>
                  <ScheduleOutlined
                    style={{ fontSize: 20, color: "#10b981" }}
                  />
                  <h3 style={{ margin: 0 }}>调度任务</h3>
                </Space>
                <Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {lastRefreshedAt
                      ? `最近刷新 ${new Date(
                          lastRefreshedAt
                        ).toLocaleTimeString()}`
                      : "尚未刷新"}
                  </Typography.Text>
                  <Button
                    icon={<ReloadOutlined />}
                    loading={loading}
                    onClick={() => loadData()}
                  >
                    刷新
                  </Button>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => setEditingJob({ is_enabled: 1 })}
                  >
                    创建调度
                  </Button>
                </Space>
              </div>

              <ProList<API.CronJob>
                rowKey="id"
                dataSource={jobs}
                loading={loading}
                metas={{
                  title: {
                    dataIndex: "name",
                    render: (text, row) => (
                      <Space>
                        <b>{text}</b>
                        {row.is_enabled ? (
                          <Tag color="success">运行中</Tag>
                        ) : (
                          <Tag>已禁用</Tag>
                        )}
                      </Space>
                    ),
                  },
                  description: {
                    render: (_, row) => {
                      const t = tasks.find((tk) => tk.id === row.task_id);
                      return (
                        <Space
                          direction="vertical"
                          style={{ width: "100%", fontSize: 13 }}
                        >
                          <div>
                            任务:{" "}
                            <Tag color="blue">
                              {t?.name || `Task ${row.task_id}`}
                            </Tag>
                          </div>
                          <div>
                            表达式: <code>{row.cron_expression}</code>
                          </div>
                          {row.next_run && (
                            <div>
                              下次执行:{" "}
                              {new Date(row.next_run).toLocaleString()}
                            </div>
                          )}
                          {row.last_run && (
                            <div>
                              上次执行:{" "}
                              {new Date(row.last_run).toLocaleString()} (
                              {renderStatusTag(row.last_status)})
                            </div>
                          )}
                        </Space>
                      );
                    },
                  },
                  actions: {
                    render: (_, row) => [
                      <a key="edit" onClick={() => setEditingJob(row)}>
                        编辑
                      </a>,
                      <a
                        key="history"
                        onClick={() => {
                          setHistoryCronJobId(row.id);
                          loadHistory(false, row.id);
                        }}
                      >
                        历史
                      </a>,
                      <a
                        key="toggle"
                        onClick={async () => {
                          await updateCronJob(row.id, {
                            is_enabled: row.is_enabled ? 0 : 1,
                          });
                          messageApi.success(
                            row.is_enabled ? "已停止" : "已启动"
                          );
                          loadData();
                        }}
                      >
                        {row.is_enabled ? "停止" : "启动"}
                      </a>,
                      <a
                        key="delete"
                        style={{ color: "red" }}
                        onClick={async () => {
                          await deleteCronJob(row.id);
                          messageApi.success("已删除");
                          loadData();
                        }}
                      >
                        删除
                      </a>,
                    ],
                  },
                }}
              />
            </Card>

            <Card className="cw-module-card" style={{ marginTop: 16 }}>
              <div
                style={{
                  marginBottom: 16,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Space>
                  <HistoryOutlined style={{ fontSize: 18, color: "#0f766e" }} />
                  <h3 style={{ margin: 0 }}>执行历史表</h3>
                </Space>
                <Space wrap>
                  <Select
                    allowClear
                    placeholder="筛选调度计划"
                    style={{ width: 240 }}
                    value={historyCronJobId}
                    onChange={(value) => {
                      const nextValue =
                        typeof value === "number" ? value : undefined;
                      setHistoryCronJobId(nextValue);
                      loadHistory(false, nextValue);
                    }}
                    options={jobs.map((job) => ({
                      label: job.name,
                      value: job.id,
                    }))}
                  />
                  <Button
                    onClick={() => loadHistory()}
                    loading={historyLoading}
                  >
                    刷新历史
                  </Button>
                </Space>
              </div>

              {cronHistory.length === 0 && !historyLoading ? (
                <Empty description="暂无 Cron 执行记录" />
              ) : (
                <Table<API.TaskRun>
                  rowKey="id"
                  loading={historyLoading}
                  dataSource={cronHistory}
                  pagination={{ pageSize: 8, hideOnSinglePage: true }}
                  columns={[
                    {
                      title: "开始时间",
                      dataIndex: "started_at",
                      render: (value) => formatDateTime(value),
                    },
                    {
                      title: "调度计划",
                      render: (_, row) =>
                        row.cron_job_name || `Job ${row.cron_job_id}`,
                    },
                    {
                      title: "任务",
                      render: (_, row) =>
                        row.task_name || `Task ${row.task_id}`,
                    },
                    {
                      title: "状态",
                      dataIndex: "status",
                      render: (value) => formatRunStatus(value),
                    },
                    {
                      title: "耗时",
                      render: (_, row) =>
                        formatDuration(row.started_at, row.finished_at),
                    },
                    {
                      title: "摘要",
                      render: (_, row) => (
                        <Typography.Paragraph
                          ellipsis={{ rows: 2, expandable: false }}
                          style={{ marginBottom: 0, maxWidth: 360 }}
                        >
                          {row.final_response ||
                            row.error_message ||
                            row.initial_message ||
                            "-"}
                        </Typography.Paragraph>
                      ),
                    },
                    {
                      title: "操作",
                      render: (_, row) =>
                        row.conversation_id ? (
                          <Button
                            type="link"
                            onClick={() =>
                              navigate(
                                `/chat?conversationId=${encodeURIComponent(
                                  String(row.conversation_id)
                                )}`
                              )
                            }
                          >
                            打开会话
                          </Button>
                        ) : (
                          "-"
                        ),
                    },
                  ]}
                />
              )}
            </Card>
          </section>
        </main>

        <ModalForm
          title={editingJob?.id ? "编辑调度" : "创建调度"}
          open={!!editingJob}
          onOpenChange={(v) => !v && setEditingJob(null)}
          modalProps={{ destroyOnHidden: true }}
          initialValues={editingJob || {}}
          onFinish={async (values) => {
            const data = {
              ...values,
              taskId: values.task_id,
              cronExpression: values.cron_expression,
              is_enabled: values.is_enabled ? 1 : 0,
            };
            if (editingJob?.id) {
              await updateCronJob(editingJob.id, data);
            } else {
              await createCronJob(data);
            }
            messageApi.success("保存成功");
            loadData();
            setEditingJob(null);
            return true;
          }}
        >
          <ProFormText
            name="name"
            label="调度计划名称"
            placeholder="每日数据巡检"
            rules={[{ required: true }]}
          />
          <ProFormSelect
            name="task_id"
            label="选择执行任务"
            options={tasks.map((t) => ({ label: t.name, value: t.id }))}
            rules={[{ required: true }]}
          />
          <ProFormText
            name="cron_expression"
            label="Cron 表达式"
            placeholder="* * * * * 每个月/天/小时/分钟"
            rules={[{ required: true }]}
            extra="例如: 0 0 * * * 表示每天零点执行"
          />
          <ProFormSwitch
            name="is_enabled"
            label="立即启用"
            checkedChildren="启用"
            unCheckedChildren="禁用"
          />
        </ModalForm>
      </div>
    </ConfigProvider>
  );
};
