import { Sidebar } from "@/components/Sidebar";
import { useShellPreferences } from "@/hooks/useShellPreferences";
import {
  createAgentTask,
  deleteAgentTask,
  generateAgentTask,
  getAgentTasks,
  getMcpServers,
  getSkills,
  getTaskRunEvents,
  getTaskRuns,
  runAgentTask,
  updateAgentTask,
} from "@/services/api";
import {
  ClockCircleOutlined,
  ExperimentOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import {
  ModalForm,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
  ProList,
} from "@ant-design/pro-components";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Drawer,
  Empty,
  Input,
  Modal,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography,
  message,
  theme as antdTheme,
} from "antd";
import { useEffect, useState } from "react";
import "../Dashboard/index.css";

type TaskRunState = {
  runId: number;
  conversationId: string;
  status: "running";
};

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

const formatTriggerSource = (triggerSource?: string) => {
  if (triggerSource === "cron") return <Tag color="purple">Cron</Tag>;
  return <Tag color="blue">手动</Tag>;
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
  const [tasks, setTasks] = useState<API.AgentTask[]>([]);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<{
    enabledSkills: number;
    enabledMcpServers: number;
    checkedAt: number;
  } | null>(null);
  const [editingTask, setEditingTask] = useState<Partial<API.AgentTask> | null>(
    null
  );
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generationResult, setGenerationResult] =
    useState<API.AgentTaskGenerationResult | null>(null);
  const [runningTaskId, setRunningTaskId] = useState<number | null>(null);
  const [runModalTask, setRunModalTask] = useState<API.AgentTask | null>(null);
  const [runMessage, setRunMessage] = useState("");
  const [runResult, setRunResult] = useState<TaskRunState | null>(null);
  const [taskRuns, setTaskRuns] = useState<API.TaskRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState<API.TaskRun | null>(null);
  const [selectedRunEvents, setSelectedRunEvents] = useState<
    API.TaskRunEvent[]
  >([]);
  const [runEventsLoading, setRunEventsLoading] = useState(false);

  const loadRuntimeSnapshot = async () => {
    const [skillData, serverData] = await Promise.all([getSkills(), getMcpServers()]);
    setRuntimeSnapshot({
      enabledSkills: skillData.filter((skill) => Number(skill.is_enabled) === 1).length,
      enabledMcpServers: serverData.filter((server) => Number(server.is_enabled) === 1).length,
      checkedAt: Date.now(),
    });
  };

  const loadRuns = async () => {
    setRunsLoading(true);
    try {
      const runs = await getTaskRuns(undefined, 20);
      setTaskRuns(runs);
    } catch {
      messageApi.error("加载任务运行记录失败");
    } finally {
      setRunsLoading(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const taskData = await getAgentTasks();
      setTasks(taskData);
    } catch {
      messageApi.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadRuns();
    loadRuntimeSnapshot().catch(() => undefined);
  }, []);

  const openRunModal = async (task: API.AgentTask) => {
    setRunModalTask(task);
    setRunMessage("");
    setRunResult(null);
    try {
      await loadRuntimeSnapshot();
    } catch {
      messageApi.warning("刷新运行时配置失败，将按后端实时配置执行");
    }
  };

  const closeRunModal = () => {
    if (runningTaskId !== null) return;
    setRunModalTask(null);
    setRunMessage("");
    setRunResult(null);
  };

  const openConversation = (conversationId: string) => {
    navigate(`/chat?conversationId=${encodeURIComponent(conversationId)}`);
  };

  const openRunTimeline = async (run: API.TaskRun) => {
    setSelectedRun(run);
    setRunEventsLoading(true);
    try {
      const events = await getTaskRunEvents(run.id);
      setSelectedRunEvents(events);
    } catch {
      messageApi.error("加载运行时间线失败");
      setSelectedRunEvents([]);
    } finally {
      setRunEventsLoading(false);
    }
  };

  const handleRunTask = async () => {
    if (!runModalTask) return;

    try {
      setRunningTaskId(runModalTask.id);
      setRunResult(null);
      const result = await runAgentTask(
        runModalTask.id,
        runMessage.trim() || undefined
      );
      const nextResult = {
        runId: Number(result.runId),
        conversationId: String(result.conversationId),
        status: "running" as const,
      };
      setRunResult(nextResult);
      messageApi.success(`任务已进入后台运行，会话 ID: ${nextResult.conversationId}`);
      void loadData();
      void loadRuns();
    } catch (error: any) {
      messageApi.error(
        error?.response?.data?.error ||
          error?.data?.error ||
          error?.message ||
          "任务启动失败"
      );
    } finally {
      setRunningTaskId(null);
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
      {messageContextHolder}
      <div className={`cw-dashboard-layout ${isDark ? "dark" : ""}`}>
        <Sidebar
          moduleExpanded={moduleExpanded}
          setModuleExpanded={setModuleExpanded}
          themeMode={themeMode}
          resolvedTheme={resolvedTheme}
          setThemeMode={setThemeMode}
          activePath="/agent-tasks"
        />

        <main className="cw-dashboard-main-wrap">
          <section className="cw-dashboard-hero">
            <div className="cw-hero-content">
              <div className="cw-dashboard-eyebrow">
                <span className="cw-pulse"></span>
                Agent Workflows
              </div>
              <h1>任务编排</h1>
              <p>
                任务只保留名称与核心 System Prompt。运行时会实时读取当前全局启用配置。
                自动化你的日常工作流，赋予 Agent 记忆与技能。
              </p>
            </div>
            <div className="cw-user-card" style={{ padding: '24px 32px' }}>
              <div className="cw-user-avatar-wrap">
                <div style={{ 
                  width: 48, 
                  height: 48, 
                  background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', 
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff'
                }}>
                  <RobotOutlined style={{ fontSize: 24 }} />
                </div>
              </div>
              <div>
                <div className="cw-user-name" style={{ fontSize: 18 }}>{tasks.length} 个任务</div>
                <div className="cw-user-desc">已就绪</div>
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
                  <RobotOutlined style={{ fontSize: 20, color: "#3b82f6" }} />
                  <h3 style={{ margin: 0 }}>我的任务</h3>
                </Space>
                <Space>
                  <Button
                    icon={<ExperimentOutlined />}
                    onClick={() => setGeneratorOpen(true)}
                  >
                    AI 生成
                  </Button>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => setEditingTask({})}
                  >
                    创建任务
                  </Button>
                </Space>
              </div>

              <ProList<API.AgentTask>
                rowKey="id"
                dataSource={Array.isArray(tasks) ? tasks : []}
                loading={loading}
                metas={{
                  title: {
                    dataIndex: "name",
                    render: (text) => <b>{text}</b>,
                  },
                  description: {
                    render: (_, row) => (
                      <Space direction="vertical" style={{ width: "100%" }}>
                        <Typography.Paragraph
                          ellipsis={{ rows: 2, expandable: false }}
                          style={{ marginBottom: 0 }}
                        >
                          {row.system_prompt}
                        </Typography.Paragraph>
                      </Space>
                    ),
                  },
                  actions: {
                    render: (_, row) => [
                      <Button
                        key="run"
                        type="link"
                        icon={<PlayCircleOutlined />}
                        loading={runningTaskId === row.id}
                        onClick={() => openRunModal(row)}
                      >
                        启动
                      </Button>,
                      <a key="edit" onClick={() => setEditingTask(row)}>
                        编辑
                      </a>,
                      <a
                        key="delete"
                        style={{ color: "red" }}
                        onClick={async () => {
                          await deleteAgentTask(row.id);
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

            {generationResult && (
              <Card className="cw-module-card" style={{ marginTop: 16 }}>
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Alert
                    showIcon
                    type="info"
                    message={
                      generationResult.analysis.summary || "已完成需求分析"
                    }
                    description={
                      generationResult.task
                        ? `已自动创建任务「${generationResult.task.name}」`
                        : "已生成任务草稿，可继续调整后保存。"
                    }
                  />
                  {generationResult.analysis.workflow_steps?.length ? (
                    <div>
                      <Typography.Text strong>工作流拆解</Typography.Text>
                      <Timeline
                        style={{ marginTop: 12 }}
                        items={generationResult.analysis.workflow_steps.map(
                          (step) => ({ children: step })
                        )}
                      />
                    </div>
                  ) : null}
                </Space>
              </Card>
            )}

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
                  <h3 style={{ margin: 0 }}>最近运行时间线</h3>
                </Space>
                <Button onClick={loadRuns} loading={runsLoading}>
                  刷新时间线
                </Button>
              </div>

              {runsLoading && taskRuns.length === 0 ? (
                <div style={{ padding: "24px 0", textAlign: "center" }}>
                  <Spin />
                </div>
              ) : taskRuns.length === 0 ? (
                <Empty description="暂无任务运行记录" />
              ) : (
                <Timeline
                  items={taskRuns.map((run) => ({
                    color:
                      run.status === "success"
                        ? "green"
                        : run.status === "failed"
                        ? "red"
                        : "blue",
                    dot:
                      run.status === "running" ? (
                        <ClockCircleOutlined />
                      ) : undefined,
                    children: (
                      <Space
                        direction="vertical"
                        size={4}
                        style={{ width: "100%" }}
                      >
                        <Space wrap>
                          <Typography.Text strong>
                            {run.task_name || `Task ${run.task_id}`}
                          </Typography.Text>
                          {formatTriggerSource(run.trigger_source)}
                          {formatRunStatus(run.status)}
                        </Space>
                        <Typography.Text type="secondary">
                          开始于 {formatDateTime(run.started_at)} · 耗时{" "}
                          {formatDuration(run.started_at, run.finished_at)}
                        </Typography.Text>
                        {run.final_response && (
                          <Typography.Paragraph
                            ellipsis={{ rows: 2, expandable: false }}
                            style={{ marginBottom: 0 }}
                          >
                            {run.final_response}
                          </Typography.Paragraph>
                        )}
                        {run.error_message && (
                          <Typography.Text type="danger">
                            {run.error_message}
                          </Typography.Text>
                        )}
                        <Space wrap>
                          <Button type="link" onClick={() => openRunTimeline(run)}>
                            查看时间线
                          </Button>
                          {run.conversation_id && (
                            <Button
                              type="link"
                              onClick={() =>
                                openConversation(String(run.conversation_id))
                              }
                            >
                              打开会话
                            </Button>
                          )}
                        </Space>
                      </Space>
                    ),
                  }))}
                />
              )}
            </Card>
          </section>
        </main>

        <ModalForm
          title={editingTask?.id ? "编辑任务" : "创建任务"}
          open={!!editingTask}
          onOpenChange={(visible) => !visible && setEditingTask(null)}
          modalProps={{ destroyOnHidden: true }}
          initialValues={editingTask || {}}
          onFinish={async (values) => {
            const payload = {
              name: String(values.name || "").trim(),
              system_prompt: String(values.system_prompt || "").trim(),
            };

            try {
              if (editingTask?.id) {
                await updateAgentTask(editingTask.id, payload);
              } else {
                await createAgentTask(payload);
              }
              messageApi.success("保存成功");
              loadData();
              setEditingTask(null);
              return true;
            } catch (error: any) {
              messageApi.error(error?.message || "保存失败");
              return false;
            }
          }}
        >
          <ProFormText
            name="name"
            label="任务名称"
            placeholder="如：技术调研、日报整理、需求拆解"
            rules={[{ required: true }]}
          />
          <ProFormTextArea
            name="system_prompt"
            label="核心 System Prompt"
            placeholder="描述这个任务的执行逻辑、约束和输出格式"
            rules={[{ required: true }]}
            fieldProps={{ rows: 10 }}
          />
        </ModalForm>

        <ModalForm
          title="AI 生成任务编排"
          open={generatorOpen}
          onOpenChange={setGeneratorOpen}
          modalProps={{ destroyOnHidden: true }}
          initialValues={{ auto_create: false }}
          onFinish={async (values) => {
            try {
              const result = await generateAgentTask({
                requirement: String(values.requirement || "").trim(),
                auto_create: Boolean(values.auto_create),
              });
              setGenerationResult(result);

              if (result.task) {
                messageApi.success(`已自动创建任务 ${result.task.name}`);
                await loadData();
                setGeneratorOpen(false);
                return true;
              }

              setEditingTask({
                name: result.draft?.name || "",
                system_prompt: result.draft?.system_prompt || "",
              });
              messageApi.success("已生成任务草稿");
              setGeneratorOpen(false);
              return true;
            } catch (error: any) {
              messageApi.error(
                error?.response?.data?.error ||
                  error?.data?.error ||
                  error?.message ||
                  "任务生成失败"
              );
              return false;
            }
          }}
        >
          <ProFormTextArea
            name="requirement"
            label="自然语言需求"
            placeholder="例如：做一个技术调研任务，先理解目标，再拆解问题，最后输出结构化结论。"
            rules={[{ required: true, message: "请输入任务需求" }]}
            fieldProps={{ rows: 6 }}
          />
          <ProFormSwitch
            name="auto_create"
            label="生成后直接创建"
            checkedChildren="直接创建"
            unCheckedChildren="仅生成草稿"
          />
        </ModalForm>

        <Modal
          title={runModalTask ? `Run · ${runModalTask.name}` : "Run"}
          open={!!runModalTask}
          onCancel={closeRunModal}
          onOk={handleRunTask}
          okText="启动任务"
          confirmLoading={runningTaskId === runModalTask?.id}
          cancelButtonProps={{ disabled: runningTaskId === runModalTask?.id }}
          destroyOnHidden
        >
          {runModalTask && (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Card
                size="small"
                styles={{
                  body: {
                    background: isDark ? "rgba(15, 23, 42, 0.42)" : "#f8fafc",
                    borderRadius: 12,
                  },
                }}
              >
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  <Typography.Text strong>运行上下文</Typography.Text>
                  <Typography.Paragraph
                    type="secondary"
                    style={{ marginBottom: 0 }}
                  >
                    本任务不会单独指定模型、Skills 或工具，后端会在启动时实时读取当前全局启用配置。
                  </Typography.Paragraph>
                  {runtimeSnapshot && (
                    <Typography.Text type="secondary">
                      最近检测：{runtimeSnapshot.enabledSkills} 个 Skill，{runtimeSnapshot.enabledMcpServers} 个 MCP（{new Date(runtimeSnapshot.checkedAt).toLocaleTimeString()}）
                    </Typography.Text>
                  )}
                </Space>
              </Card>

              <div>
                <Typography.Text strong>本次运行目标</Typography.Text>
                <Input.TextArea
                  rows={4}
                  value={runMessage}
                  onChange={(event) => setRunMessage(event.target.value)}
                  placeholder="可选：输入这次运行的具体目标、约束或验收条件。留空时后端会自动补一条启动消息。"
                  style={{ marginTop: 8 }}
                  disabled={runningTaskId === runModalTask.id}
                />
              </div>

              {runResult && (
                <Alert
                  showIcon
                  type="success"
                  message={`已创建运行会话 #${runResult.conversationId}`}
                  description={
                    <Space direction="vertical" size={8}>
                      <Typography.Text type="secondary">
                        任务已经在后台开始执行，不会再阻塞当前页面。你可以直接进入会话查看实时轨迹，或在下方时间线里刷新运行状态。
                      </Typography.Text>
                      <div>
                        <Button
                          type="link"
                          style={{ paddingInline: 0 }}
                          onClick={() =>
                            openConversation(runResult.conversationId)
                          }
                        >
                          前往会话
                        </Button>
                        <Button
                          type="link"
                          onClick={() => loadRuns()}
                        >
                          刷新时间线
                        </Button>
                      </div>
                    </Space>
                  }
                />
              )}
            </Space>
          )}
        </Modal>

        <Drawer
          title={selectedRun ? `运行时间线 · #${selectedRun.id}` : "运行时间线"}
          open={!!selectedRun}
          onClose={() => {
            setSelectedRun(null);
            setSelectedRunEvents([]);
          }}
          width={640}
        >
          {selectedRun ? (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Card size="small">
                <Space direction="vertical" size={4}>
                  <Typography.Text strong>
                    {selectedRun.task_name || `Task ${selectedRun.task_id}`}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    开始于 {formatDateTime(selectedRun.started_at)} · 耗时{" "}
                    {formatDuration(
                      selectedRun.started_at,
                      selectedRun.finished_at
                    )}
                  </Typography.Text>
                  <Space wrap>
                    {formatTriggerSource(selectedRun.trigger_source)}
                    {formatRunStatus(selectedRun.status)}
                  </Space>
                </Space>
              </Card>

              {runEventsLoading ? (
                <div style={{ textAlign: "center", padding: "24px 0" }}>
                  <Spin />
                </div>
              ) : selectedRunEvents.length === 0 ? (
                <Empty description="暂无事件明细" />
              ) : (
                <Timeline
                  items={selectedRunEvents.map((event) => ({
                    children: (
                      <Space direction="vertical" size={4}>
                        <Typography.Text strong>{event.title}</Typography.Text>
                        {event.content ? (
                          <Typography.Text type="secondary">
                            {event.content}
                          </Typography.Text>
                        ) : null}
                        <Typography.Text type="secondary">
                          {formatDateTime(event.created_at)}
                        </Typography.Text>
                      </Space>
                    ),
                  }))}
                />
              )}
            </Space>
          ) : null}
        </Drawer>
      </div>
    </ConfigProvider>
  );
};
