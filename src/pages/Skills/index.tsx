import { Sidebar } from "@/components/Sidebar";
import {
  createSkill,
  deleteSkill,
  generateSkillDraft,
  getMcpTools,
  getSkills,
  updateSkill,
} from "@/services/api";
import {
  PlusOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  ModalForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
  ProList,
} from "@ant-design/pro-components";
import { useAppStore } from "@/stores/useAppStore";
import {
  theme as antdTheme,
  Button,
  Card,
  ConfigProvider,
  message,
  Space,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import "../Dashboard/index.css";

export default () => {
  const { currentUser, isLoggedIn } = useAppStore();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [moduleExpanded, setModuleExpanded] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<API.Skill[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [editingSkill, setEditingSkill] = useState<Partial<API.Skill> | null>(
    null
  );
  const [generatorOpen, setGeneratorOpen] = useState(false);

  const isDark = theme === "dark";

  const loadData = async () => {
    setLoading(true);
    try {
      const [skillData, toolData] = await Promise.all([
        getSkills(),
        getMcpTools().catch(() => []),
      ]);

      setSkills(skillData);
      setAvailableTools(
        Array.from(
          new Set(
            (Array.isArray(toolData) ? toolData : [])
              .map((tool) => tool?.function?.name)
              .filter(Boolean)
          )
        )
      );
    } catch (e) {
      messageApi.error("加载技能失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const skillInitialValues = editingSkill
    ? {
        ...editingSkill,
        tools: Array.isArray(editingSkill.tools) ? editingSkill.tools : [],
      }
    : {};

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
          theme={theme}
          setTheme={setTheme}
          activePath="/skills"
        />

        <main className="cw-dashboard-main-wrap">
          <section className="cw-dashboard-hero">
            <div>
              <div className="cw-dashboard-eyebrow">Skills</div>
              <h1>技能库</h1>
              <p>
                手工维护技能，或直接用自然语言生成技能草稿，再补充工具约束后保存。
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
                  <ThunderboltOutlined
                    style={{ fontSize: 20, color: "#f59e0b" }}
                  />
                  <h3 style={{ margin: 0 }}>我的技能</h3>
                </Space>
                <Space>
                  <Button
                    icon={<RobotOutlined />}
                    onClick={() => setGeneratorOpen(true)}
                  >
                    AI 生成
                  </Button>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => setEditingSkill({ tools: [] })}
                  >
                    添加技能
                  </Button>
                </Space>
              </div>

              <ProList<API.Skill>
                rowKey="id"
                dataSource={skills}
                loading={loading}
                metas={{
                  title: {
                    dataIndex: "name",
                    render: (text) => <b>{text}</b>,
                  },
                  description: {
                    render: (_, row) => (
                      <Space direction="vertical" style={{ width: "100%" }}>
                        <Typography.Text>
                          {row.description || "-"}
                        </Typography.Text>
                        {row.tools?.length ? (
                          <Space wrap>
                            {row.tools.map((tool) => (
                              <Tag key={tool} color="geekblue">
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
                      <a key="edit" onClick={() => setEditingSkill(row)}>
                        编辑
                      </a>,
                      <a
                        key="delete"
                        style={{ color: "red" }}
                        onClick={async () => {
                          await deleteSkill(row.id);
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
          </section>
        </main>

        <ModalForm
          title={editingSkill?.id ? "编辑技能" : "添加技能"}
          open={!!editingSkill}
          onOpenChange={(visible) => !visible && setEditingSkill(null)}
          modalProps={{ destroyOnHidden: true }}
          initialValues={skillInitialValues}
          onFinish={async (values) => {
            const payload = {
              ...values,
              tools: Array.isArray(values.tools) ? values.tools : [],
            };

            if (editingSkill?.id) {
              await updateSkill(editingSkill.id, payload);
            } else {
              await createSkill(payload);
            }
            messageApi.success("保存成功");
            loadData();
            setEditingSkill(null);
            return true;
          }}
        >
          <ProFormText
            name="name"
            label="技能名称"
            placeholder="如：网页搜索、代码审计"
            rules={[{ required: true }]}
          />
          <ProFormText name="description" label="简介" />
          <ProFormTextArea
            name="prompt"
            label="System Prompt 增强"
            placeholder="描述此技能的具体逻辑、约束和输出格式"
            rules={[{ required: true }]}
            fieldProps={{ rows: 8 }}
          />
          <ProFormSelect
            name="tools"
            label="关联工具"
            mode="multiple"
            placeholder="可选：绑定此技能运行时需要的 MCP 工具"
            options={availableTools.map((tool) => ({
              label: tool,
              value: tool,
            }))}
          />
        </ModalForm>

        <ModalForm
          title="AI 生成技能"
          open={generatorOpen}
          onOpenChange={setGeneratorOpen}
          modalProps={{ destroyOnHidden: true }}
          initialValues={{ auto_create: false }}
          onFinish={async (values) => {
            try {
              const result = await generateSkillDraft({
                requirement: String(values.requirement || "").trim(),
                auto_create: Boolean(values.auto_create),
              });

              if (result.skill) {
                messageApi.success(
                  `已使用 ${result.model || "默认模型"} 自动创建技能`
                );
                loadData();
                setGeneratorOpen(false);
                return true;
              }

              setEditingSkill({
                ...result.draft,
                tools: Array.isArray(result.draft?.tools)
                  ? result.draft.tools
                  : [],
              });
              messageApi.success(
                `已生成技能草稿，来自 ${result.endpoint || "默认 Endpoint"}`
              );
              setGeneratorOpen(false);
              return true;
            } catch (error: any) {
              messageApi.error(
                error?.response?.data?.error ||
                  error?.data?.error ||
                  error?.message ||
                  "技能生成失败"
              );
              return false;
            }
          }}
        >
          <ProFormTextArea
            name="requirement"
            label="自然语言需求"
            placeholder="例如：帮我生成一个竞品调研技能，要先拆解目标，再做网页检索，最后输出结构化结论，并优先使用已接入的搜索工具。"
            rules={[{ required: true, message: "请输入技能需求" }]}
            fieldProps={{ rows: 6 }}
          />
          <ProFormSwitch
            name="auto_create"
            label="生成后直接保存"
            checkedChildren="直接创建"
            unCheckedChildren="仅生成草稿"
          />
        </ModalForm>
      </div>
    </ConfigProvider>
  );
};
