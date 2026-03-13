import { Sidebar } from "@/components/Sidebar";
import { useShellPreferences } from "@/hooks/useShellPreferences";
import {
  createSkill,
  createAgentTask,
  deleteAgentTask,
  generateAgentTask,
  generateDraftFromMarketMcp,
  getAgentTasks,
  getAvailableModels,
  getMcpServers,
  getMcpTools,
  getSkills,
  importDefaultMcpTemplate,
  getTaskRunEvents,
  getTaskRuns,
  runAgentTask,
  updateAgentTask,
} from "@/services/api";
import {
  ClockCircleOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  ExperimentOutlined,
} from "@ant-design/icons";
import {
  ModalForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
  ProList,
} from "@ant-design/pro-components";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/stores/useAppStore";
import {
  Alert,
  theme as antdTheme,
  Button,
  Card,
  ConfigProvider,
  Drawer,
  Empty,
  Input,
  Modal,
  message,
  Spin,
  Space,
  Tag,
  Timeline,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import "../Dashboard/index.css";

type TaskRunState = {
  runId: number;
  conversationId: string;
  finalResponse: string;
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
  const [tasks, setTasks] = useState<API.AgentTask[]>([]);
  const [editingTask, setEditingTask] = useState<Partial<API.AgentTask> | null>(
    null
  );
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [generationResult, setGenerationResult] =
    useState<API.AgentTaskGenerationResult | null>(null);

  const [skills, setSkills] = useState<API.Skill[]>([]);
  const [mcpServers, setMcpServers] = useState<API.McpServer[]>([]);
  const [availableModels, setAvailableModels] = useState<API.Model[]>([]);
  const [availableTools, setAvailableTools] = useState<any[]>([]);
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
  const [importingTemplateId, setImportingTemplateId] = useState<string | null>(
    null
  );
  const [creatingSkillName, setCreatingSkillName] = useState<string | null>(
    null
  );
  const [marketDraftingName, setMarketDraftingName] = useState<string | null>(
    null
  );

  const loadData = async () => {
    setLoading(true);
    try {
      const [t, s, m, models, tools] = await Promise.all([
        getAgentTasks(),
        getSkills(),
        getMcpServers(),
        getAvailableModels(),
        getMcpTools(),
      ]);
      setTasks(t);
      setSkills(s);
      setMcpServers(m);
      setAvailableModels(models);
      setAvailableTools(tools);
    } catch (e) {
      messageApi.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    loadRuns();
  }, []);

  const handleImportTemplateFromSuggestions = async (templateId: string) => {
    try {
      setImportingTemplateId(templateId);
      const result = await importDefaultMcpTemplate(templateId);
      messageApi.success(
        result.template.needs_configuration
          ? "默认 MCP 已导入，请补充配置后启用"
          : "默认 MCP 已导入"
      );
      await loadData();
    } catch (error: any) {
      messageApi.error(
        error?.response?.data?.error ||
          error?.data?.error ||
          error?.message ||
          "导入默认 MCP 失败"
      );
    } finally {
      setImportingTemplateId(null);
    }
  };

  const handleCreateSuggestedSkill = async (skillDraft: Partial<API.Skill>) => {
    try {
      setCreatingSkillName(String(skillDraft.name || ""));
      const created = await createSkill({
        name: skillDraft.name,
        description: skillDraft.description,
        prompt: skillDraft.prompt,
        tools: Array.isArray(skillDraft.tools) ? skillDraft.tools : [],
      });
      messageApi.success(`已创建技能 ${created.name}`);
      await loadData();
      setEditingTask((current) =>
        current
          ? {
              ...current,
              skill_ids: Array.from(
                new Set([...(current.skill_ids || []), created.id])
              ),
            }
          : current
      );
    } catch (error: any) {
      messageApi.error(
        error?.response?.data?.error ||
          error?.data?.error ||
          error?.message ||
          "创建技能失败"
      );
    } finally {
      setCreatingSkillName(null);
    }
  };

  const handleImportMarketMcp = async (serverName: string) => {
    try {
      setMarketDraftingName(serverName);
      await generateDraftFromMarketMcp({
        server_name: serverName,
        auto_create: true,
      });
      messageApi.success("市场 MCP 已导入");
      await loadData();
    } catch (error: any) {
      messageApi.error(
        error?.response?.data?.error ||
          error?.data?.error ||
          error?.message ||
          "导入市场 MCP 失败"
      );
    } finally {
      setMarketDraftingName(null);
    }
  };

  const loadRuns = async () => {
    setRunsLoading(true);
    try {
      const runs = await getTaskRuns(undefined, 20);
      setTaskRuns(runs);
    } catch (error) {
      messageApi.error("加载任务运行记录失败");
    } finally {
      setRunsLoading(false);
    }
  };

  const openRunModal = (task: API.AgentTask) => {
    setRunModalTask(task);
    setRunMessage("");
    setRunResult(null);
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
    } catch (error) {
      messageApi.error("加载运行时间线失败");
      setSelectedRunEvents([]);
    } finally {
      setRunEventsLoading(false);
    }
  };

  const closeRunTimeline = () => {
    setSelectedRun(null);
    setSelectedRunEvents([]);
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
        finalResponse: String(result.finalResponse || ""),
      };
      setRunResult(nextResult);
      messageApi.success(`任务已启动，会话 ID: ${nextResult.conversationId}`);
      await loadData();
      await loadRuns();
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
            <div>
              <div className="cw-dashboard-eyebrow">Agent Workflows</div>
              <h1>任务编排</h1>
              <p>
                定义具有特定角色的子 Agent，组合技能和工具，构建自动化的业务流。
              </p>
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
                    onClick={() =>
                      setEditingTask({ skill_ids: [], tool_names: [] })
                    }
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
                        <div>{row.description}</div>
                        <Space>
                          {row.skill_ids?.map((sid) => {
                            const s = (
                              Array.isArray(skills) ? skills : []
                            ).find((sk) => sk.id === sid);
                            return (
                              <Tag key={sid} color="orange">
                                {s?.name || `Skill ${sid}`}
                              </Tag>
                            );
                          })}
                          {row.tool_names?.map((tn) => (
                            <Tag key={tn} color="cyan">
                              {tn}
                            </Tag>
                          ))}
                        </Space>
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
                <div
                  style={{
                    marginBottom: 16,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Space>
                    <ExperimentOutlined
                      style={{ fontSize: 18, color: "#8b5cf6" }}
                    />
                    <h3 style={{ margin: 0 }}>需求分析与建议</h3>
                  </Space>
                  <Typography.Text type="secondary">
                    {generationResult.endpoint || "默认 Endpoint"} ·{" "}
                    {generationResult.model || "默认模型"}
                  </Typography.Text>
                </div>

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
                          (step) => ({
                            children: step,
                          })
                        )}
                      />
                    </div>
                  ) : null}

                  {generationResult.analysis.capability_breakdown?.length ? (
                    <div>
                      <Typography.Text strong>能力拆解</Typography.Text>
                      <div style={{ marginTop: 8 }}>
                        <Space wrap>
                          {generationResult.analysis.capability_breakdown.map(
                            (item) => (
                              <Tag key={item} color="purple">
                                {item}
                              </Tag>
                            )
                          )}
                        </Space>
                      </div>
                    </div>
                  ) : null}

                  {generationResult.suggested_skills?.length ? (
                    <div>
                      <Typography.Text strong>建议新增技能</Typography.Text>
                      <ProList<Partial<API.Skill>>
                        rowKey={(row) => String(row.name)}
                        style={{ marginTop: 12 }}
                        dataSource={generationResult.suggested_skills}
                        metas={{
                          title: {
                            render: (_, row) => <b>{row.name}</b>,
                          },
                          description: {
                            render: (_, row) => (
                              <Space
                                direction="vertical"
                                style={{ width: "100%" }}
                              >
                                <Typography.Text>
                                  {row.description || "-"}
                                </Typography.Text>
                                {row.tools?.length ? (
                                  <Space wrap>
                                    {row.tools.map((tool) => (
                                      <Tag key={tool} color="orange">
                                        {tool}
                                      </Tag>
                                    ))}
                                  </Space>
                                ) : null}
                              </Space>
                            ),
                          },
                          actions: {
                            render: (_, row) => [
                              <Button
                                key="create"
                                type="link"
                                loading={creatingSkillName === row.name}
                                onClick={() => handleCreateSuggestedSkill(row)}
                              >
                                导入为技能
                              </Button>,
                            ],
                          },
                        }}
                      />
                    </div>
                  ) : null}

                  {generationResult.recommended_mcp_templates?.length ? (
                    <div>
                      <Typography.Text strong>
                        推荐导入的默认 MCP
                      </Typography.Text>
                      <ProList<API.DefaultMcpTemplate>
                        rowKey="id"
                        style={{ marginTop: 12 }}
                        dataSource={generationResult.recommended_mcp_templates}
                        metas={{
                          title: {
                            render: (_, row) => (
                              <Space wrap>
                                <b>{row.name}</b>
                                <Tag color="blue">{row.category}</Tag>
                                {row.needs_configuration ? (
                                  <Tag color="orange">需配置</Tag>
                                ) : (
                                  <Tag color="success">可直接导入</Tag>
                                )}
                              </Space>
                            ),
                          },
                          description: {
                            dataIndex: "description",
                          },
                          actions: {
                            render: (_, row) => [
                              <Button
                                key="import"
                                type="link"
                                loading={importingTemplateId === row.id}
                                onClick={() =>
                                  handleImportTemplateFromSuggestions(row.id)
                                }
                              >
                                导入默认 MCP
                              </Button>,
                            ],
                          },
                        }}
                      />
                    </div>
                  ) : null}

                  {generationResult.market_mcp_recommendations?.length ? (
                    <div>
                      <Typography.Text strong>
                        市场 MCP 检索结果
                      </Typography.Text>
                      <ProList<API.AgentTaskGenerationMarketMcp>
                        rowKey={(row) => `${row.name}-${row.transport}`}
                        style={{ marginTop: 12 }}
                        dataSource={generationResult.market_mcp_recommendations}
                        metas={{
                          title: {
                            render: (_, row) => (
                              <Space wrap>
                                <b>{row.title || row.name}</b>
                                {row.transport ? (
                                  <Tag color="geekblue">{row.transport}</Tag>
                                ) : null}
                                {row.template_id ? (
                                  <Tag color="gold">有默认模板</Tag>
                                ) : null}
                              </Space>
                            ),
                          },
                          description: {
                            render: (_, row) => (
                              <Space direction="vertical">
                                <Typography.Text>{row.reason}</Typography.Text>
                                {row.repository_url ? (
                                  <Typography.Link
                                    href={row.repository_url}
                                    target="_blank"
                                  >
                                    仓库链接
                                  </Typography.Link>
                                ) : null}
                              </Space>
                            ),
                          },
                          actions: {
                            render: (_, row) =>
                              row.template_id
                                ? [
                                    <Button
                                      key="import-template"
                                      type="link"
                                      loading={
                                        importingTemplateId === row.template_id
                                      }
                                      onClick={() =>
                                        handleImportTemplateFromSuggestions(
                                          String(row.template_id)
                                        )
                                      }
                                    >
                                      导入对应默认模板
                                    </Button>,
                                  ]
                                : [
                                    <Button
                                      key="import-market"
                                      type="link"
                                      loading={marketDraftingName === row.name}
                                      onClick={() =>
                                        handleImportMarketMcp(row.name)
                                      }
                                    >
                                      直接导入市场 MCP
                                    </Button>,
                                  ],
                          },
                        }}
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
                          <Button
                            type="link"
                            onClick={() => openRunTimeline(run)}
                          >
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
          onOpenChange={(v) => !v && setEditingTask(null)}
          modalProps={{ destroyOnHidden: true }}
          initialValues={editingTask || {}}
          onFinish={async (values) => {
            if (editingTask?.id) {
              await updateAgentTask(editingTask.id, values);
            } else {
              await createAgentTask(values);
            }
            messageApi.success("保存成功");
            loadData();
            setEditingTask(null);
            return true;
          }}
        >
          <ProFormText
            name="name"
            label="任务名称"
            placeholder="如：翻译专家、技术调研、网页巡检"
            rules={[{ required: true }]}
          />
          <ProFormText name="description" label="简介" />
          <ProFormTextArea
            name="system_prompt"
            label="核心 System Prompt"
            placeholder="描述此技能的具体逻辑、约束和输出格式"
            rules={[{ required: true }]}
          />

          <ProFormSelect
            name="model_id"
            label="指定模型"
            placeholder="留空即使用默认模型"
            options={(Array.isArray(availableModels)
              ? availableModels
              : []
            ).map((m) => ({
              label: m.display_name || m.model_id,
              value: m.model_id,
            }))}
          />

          <ProFormSelect
            name="skill_ids"
            label="关联技能"
            mode="multiple"
            options={(Array.isArray(skills) ? skills : []).map((s) => ({
              label: s.name,
              value: s.id,
            }))}
          />

          <ProFormSelect
            name="tool_names"
            label="启用工具"
            mode="multiple"
            placeholder="从 MCP 服务器中选择要启用的具体工具"
            options={(Array.isArray(availableTools) ? availableTools : []).map(
              (t) => ({
                label: t?.function?.name || "Unknown Tool",
                value: t?.function?.name || "unknown",
              })
            )}
            fieldProps={{
              mode: "multiple", // 改回 multiple，也可以保留 tags 但已有选项
            }}
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
                ...(result.draft || {}),
                skill_ids: Array.isArray(result.draft?.skill_ids)
                  ? result.draft.skill_ids
                  : [],
                tool_names: Array.isArray(result.draft?.tool_names)
                  ? result.draft.tool_names
                  : [],
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
            placeholder="例如：做一个技术调研 Agent，先理解需求，再拆解关键能力，研究市场上可用的 MCP，优先复用现有技能和工具，最后输出调研报告。"
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
          title={
            runModalTask ? `Run & Debug · ${runModalTask.name}` : "Run & Debug"
          }
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
                  <Space wrap>
                    {(runModalTask.skill_ids || []).map((sid) => {
                      const skill = skills.find((item) => item.id === sid);
                      return (
                        <Tag key={sid} color="orange">
                          {skill?.name || `Skill ${sid}`}
                        </Tag>
                      );
                    })}
                    {(runModalTask.tool_names || []).map((name) => (
                      <Tag key={name} color="cyan">
                        {name}
                      </Tag>
                    ))}
                    {!runModalTask.skill_ids?.length &&
                      !runModalTask.tool_names?.length && <Tag>无额外挂载</Tag>}
                  </Space>
                  <Typography.Paragraph
                    type="secondary"
                    style={{ marginBottom: 0 }}
                  >
                    {runModalTask.description || "当前任务未填写简介。"}
                  </Typography.Paragraph>
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
                        {runResult.finalResponse
                          ? runResult.finalResponse
                          : "本次运行未生成最终总结，建议直接进入聊天页查看完整工具轨迹。"}
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
                          style={{ paddingInline: 0, marginLeft: 12 }}
                          onClick={() => {
                            const matchedRun = taskRuns.find(
                              (item) => item.id === runResult.runId
                            );
                            openRunTimeline(
                              matchedRun || {
                                id: runResult.runId,
                                task_id: runModalTask.id,
                                task_name: runModalTask.name,
                                trigger_source: "manual",
                                status: "success",
                                conversation_id: runResult.conversationId,
                                final_response: runResult.finalResponse,
                              }
                            );
                          }}
                        >
                          查看时间线
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
          title={
            selectedRun
              ? `运行时间线 · ${
                  selectedRun.task_name || `Task ${selectedRun.task_id}`
                }`
              : "运行时间线"
          }
          width={560}
          open={!!selectedRun}
          onClose={closeRunTimeline}
          destroyOnHidden
        >
          {selectedRun && (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Card size="small">
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <Space wrap>
                    {formatTriggerSource(selectedRun.trigger_source)}
                    {formatRunStatus(selectedRun.status)}
                    <Typography.Text type="secondary">
                      开始于 {formatDateTime(selectedRun.started_at)}
                    </Typography.Text>
                  </Space>
                  <Typography.Text type="secondary">
                    耗时{" "}
                    {formatDuration(
                      selectedRun.started_at,
                      selectedRun.finished_at
                    )}
                  </Typography.Text>
                  {selectedRun.final_response && (
                    <Typography.Paragraph style={{ marginBottom: 0 }}>
                      {selectedRun.final_response}
                    </Typography.Paragraph>
                  )}
                  {selectedRun.error_message && (
                    <Typography.Text type="danger">
                      {selectedRun.error_message}
                    </Typography.Text>
                  )}
                  {selectedRun.conversation_id && (
                    <Button
                      type="link"
                      style={{ paddingInline: 0 }}
                      onClick={() =>
                        openConversation(String(selectedRun.conversation_id))
                      }
                    >
                      打开关联会话
                    </Button>
                  )}
                </Space>
              </Card>

              {runEventsLoading ? (
                <div style={{ padding: "32px 0", textAlign: "center" }}>
                  <Spin />
                </div>
              ) : selectedRunEvents.length === 0 ? (
                <Empty description="暂无时间线事件" />
              ) : (
                <Timeline
                  items={selectedRunEvents.map((event) => ({
                    color:
                      event.event_type === "run_failed"
                        ? "red"
                        : event.event_type === "tool_failed"
                        ? "red"
                        : event.event_type === "forced_summary"
                        ? "orange"
                        : event.event_type === "run_completed"
                        ? "green"
                        : "blue",
                    children: (
                      <Space
                        direction="vertical"
                        size={2}
                        style={{ width: "100%" }}
                      >
                        <Space wrap>
                          <Typography.Text strong>
                            {event.title}
                          </Typography.Text>
                          <Typography.Text type="secondary">
                            {formatDateTime(event.created_at)}
                          </Typography.Text>
                        </Space>
                        {event.content && (
                          <Typography.Paragraph style={{ marginBottom: 0 }}>
                            {event.content}
                          </Typography.Paragraph>
                        )}
                      </Space>
                    ),
                  }))}
                />
              )}
            </Space>
          )}
        </Drawer>
      </div>
    </ConfigProvider>
  );
};
