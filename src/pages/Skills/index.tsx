import { Sidebar } from "@/components/Sidebar";
import { useShellPreferences } from "@/hooks/useShellPreferences";
import {
  createSkill,
  deleteSkill,
  generateSkillDraft,
  getMcpTools,
  getSkills,
  installSkillFromGitRepository,
  installSkillFromZipArchive,
  updateSkill,
} from "@/services/api";
import {
  InboxOutlined,
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
  Upload,
  Input,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { useEffect, useState } from "react";
import "../Dashboard/index.css";

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
  });

export default () => {
  const { currentUser, isLoggedIn } = useAppStore();
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
  const [skills, setSkills] = useState<API.Skill[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [editingSkill, setEditingSkill] = useState<Partial<API.Skill> | null>(
    null
  );
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [installingGit, setInstallingGit] = useState(false);
  const [zipFileList, setZipFileList] = useState<UploadFile[]>([]);
  const [installingZip, setInstallingZip] = useState(false);

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

  const selectedZipFile = zipFileList[0]?.originFileObj;

  const handleInstallGit = async () => {
    if (!gitRepoUrl.trim()) {
      messageApi.error("请输入 Git 仓库地址");
      return;
    }

    setInstallingGit(true);
    try {
      const result = await installSkillFromGitRepository(gitRepoUrl.trim());
      messageApi.success(
        result.updated
          ? `已更新并同步 ${result.installed_count} 个 Skill`
          : `已安装 ${result.installed_count} 个 Skill`
      );
      setGitRepoUrl("");
      await loadData();
    } catch (error: any) {
      messageApi.error(error?.message || "Git Skill 安装失败");
    } finally {
      setInstallingGit(false);
    }
  };

  const handleInstallZip = async () => {
    if (!selectedZipFile) {
      messageApi.error("请先选择一个 zip 包");
      return;
    }

    setInstallingZip(true);
    try {
      const zipBase64 = await fileToBase64(selectedZipFile);
      const result = await installSkillFromZipArchive(
        selectedZipFile.name,
        zipBase64
      );
      messageApi.success(`已导入 ${result.installed_count} 个 Skill`);
      setZipFileList([]);
      await loadData();
    } catch (error: any) {
      messageApi.error(error?.message || "ZIP Skill 安装失败");
    } finally {
      setInstallingZip(false);
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
            <Card className="cw-module-card" style={{ marginBottom: 16 }}>
              <div
                style={{
                  marginBottom: 16,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <Space>
                  <ThunderboltOutlined
                    style={{ fontSize: 20, color: "#f59e0b" }}
                  />
                  <h3 style={{ margin: 0 }}>安装 Skill 包</h3>
                </Space>
                <Typography.Text type="secondary">
                  支持 Git 仓库安装/更新，以及 ZIP 拖拽导入。后端会校验
                  `SKILL.md` 格式，不合法会拒绝安装。
                </Typography.Text>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                  gap: 16,
                }}
              >
                <Card size="small" title="Git 仓库">
                  <Space
                    direction="vertical"
                    size={12}
                    style={{ width: "100%" }}
                  >
                    <Typography.Text type="secondary">
                      输入 Skill
                      仓库地址。再次输入同一地址时会强制拉取最新内容并覆盖同步。
                    </Typography.Text>
                    <Input
                      value={gitRepoUrl}
                      onChange={(event) => setGitRepoUrl(event.target.value)}
                      placeholder="https://github.com/owner/repo 或 git@github.com:owner/repo.git"
                    />
                    <Button
                      type="primary"
                      loading={installingGit}
                      onClick={handleInstallGit}
                    >
                      安装 / 更新仓库 Skill
                    </Button>
                  </Space>
                </Card>

                <Card size="small" title="ZIP 包">
                  <Space
                    direction="vertical"
                    size={12}
                    style={{ width: "100%" }}
                  >
                    <Upload.Dragger
                      accept=".zip"
                      maxCount={1}
                      multiple={false}
                      fileList={zipFileList}
                      beforeUpload={(file) => {
                        if (!file.name.toLowerCase().endsWith(".zip")) {
                          messageApi.error("仅支持上传 zip 包");
                          return Upload.LIST_IGNORE;
                        }
                        setZipFileList([file]);
                        return false;
                      }}
                      onRemove={() => {
                        setZipFileList([]);
                        return true;
                      }}
                    >
                      <p className="ant-upload-drag-icon">
                        <InboxOutlined />
                      </p>
                      <p className="ant-upload-text">
                        拖拽 zip 到这里，或点击选择文件
                      </p>
                      <p className="ant-upload-hint">
                        服务端会解压并检查是否包含合法的 `SKILL.md`
                      </p>
                    </Upload.Dragger>
                    <Button
                      type="primary"
                      loading={installingZip}
                      disabled={!selectedZipFile}
                      onClick={handleInstallZip}
                    >
                      导入 ZIP Skill
                    </Button>
                  </Space>
                </Card>
              </div>
            </Card>

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
                        <Space wrap>
                          {row.source_type ? (
                            <Tag
                              color={
                                row.source_type === "git" ? "green" : "gold"
                              }
                            >
                              {row.source_type === "git" ? "Git" : "ZIP"}
                            </Tag>
                          ) : (
                            <Tag>手工</Tag>
                          )}
                          {row.source_location ? (
                            <Tag>{row.source_location}</Tag>
                          ) : null}
                        </Space>
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
