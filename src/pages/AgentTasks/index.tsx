import { AccountModal } from "@/components/AccountModal";
import { SettingsModal } from "@/components/SettingsModal";
import { Sidebar } from "@/components/Sidebar";
import {
  createAgentTask,
  deleteAgentTask,
  getAgentTasks,
  getAvailableModels,
  getMcpServers,
  getMcpTools,
  getSkills,
  runAgentTask,
  updateAgentTask,
} from "@/services/api";
import {
  PlayCircleOutlined,
  PlusOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import {
  ModalForm,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
  ProList,
} from "@ant-design/pro-components";
import { useModel } from "@umijs/max";
import {
  theme as antdTheme,
  Button,
  Card,
  ConfigProvider,
  message,
  Space,
  Tag,
} from "antd";
import { useEffect, useState } from "react";
import "../Dashboard/index.css";

export default () => {
  const { currentUser, isLoggedIn } = useModel("global");
  const [moduleExpanded, setModuleExpanded] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [showAccount, setShowAccount] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<API.AgentTask[]>([]);
  const [editingTask, setEditingTask] = useState<Partial<API.AgentTask> | null>(
    null
  );

  const [skills, setSkills] = useState<API.Skill[]>([]);
  const [mcpServers, setMcpServers] = useState<API.McpServer[]>([]);
  const [availableModels, setAvailableModels] = useState<API.Model[]>([]);
  const [availableTools, setAvailableTools] = useState<any[]>([]);

  const isDark = theme === "dark";

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
      message.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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
          activePath="/agent-tasks"
          setShowAccount={setShowAccount}
          setShowSettings={setShowSettings}
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
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setEditingTask({ skill_ids: [], tool_names: [] })
                  }
                >
                  创建任务
                </Button>
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
                            const s = (Array.isArray(skills) ? skills : []).find((sk) => sk.id === sid);
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
                        onClick={async () => {
                          message.loading("正在启动任务...");
                          const result = await runAgentTask(row.id);
                          message.success(
                            "任务完成，对话 ID: " + result.conversationId
                          );
                        }}
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
                          message.success("已删除");
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
          </section>
        </main>

        <ModalForm
          title={editingTask?.id ? "编辑任务" : "创建任务"}
          open={!!editingTask}
          onOpenChange={(v) => !v && setEditingTask(null)}
          modalProps={{ destroyOnClose: true }}
          initialValues={editingTask || {}}
          onFinish={async (values) => {
            if (editingTask?.id) {
              await updateAgentTask(editingTask.id, values);
            } else {
              await createAgentTask(values);
            }
            message.success("保存成功");
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
            options={(Array.isArray(availableModels) ? availableModels : []).map((m) => ({
              label: m.display_name || m.model_id,
              value: m.model_id,
            }))}
          />

          <ProFormSelect
            name="skill_ids"
            label="关联技能"
            mode="multiple"
            options={(Array.isArray(skills) ? skills : []).map((s) => ({ label: s.name, value: s.id }))}
          />

          <ProFormSelect
            name="tool_names"
            label="启用工具"
            mode="multiple"
            placeholder="从 MCP 服务器中选择要启用的具体工具"
            options={(Array.isArray(availableTools) ? availableTools : []).map((t) => ({
              label: t?.function?.name || 'Unknown Tool',
              value: t?.function?.name || 'unknown',
            }))}
            fieldProps={{
              mode: "multiple", // 改回 multiple，也可以保留 tags 但已有选项
            }}
          />
        </ModalForm>

        <AccountModal
          open={showAccount}
          onClose={() => setShowAccount(false)}
          isDark={isDark}
        />
        <SettingsModal open={showSettings} onOpenChange={setShowSettings} />
      </div>
    </ConfigProvider>
  );
};
