import { Sidebar } from "@/components/Sidebar";
import { useShellPreferences } from "@/hooks/useShellPreferences";
import {
  batchDeleteSkills,
  batchUpdateSkills,
  deleteSkill,
  getMcpTools,
  getSkills,
  installSkillFromGitRepository,
  installSkillFromZipArchive,
  updateSkill,
} from "@/services/api";
import {
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
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
import {
  theme as antdTheme,
  Button,
  Card,
  Checkbox,
  ConfigProvider,
  Input,
  Popconfirm,
  Popover,
  Space,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { useEffect, useState } from "react";
import "../Dashboard/index.css";

const RECOMMENDED_SKILL_REPOS = [
  "https://github.com/vercel-labs/agent-browser",
  "https://github.com/anthropics/skills",
];

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
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [installingGit, setInstallingGit] = useState(false);
  const [zipFileList, setZipFileList] = useState<UploadFile[]>([]);
  const [installingZip, setInstallingZip] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState<number[]>([]);

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
    } catch {
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
        is_enabled: Number(editingSkill.is_enabled) !== 0,
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

  const handleToggleSkill = async (row: API.Skill, checked: boolean) => {
    try {
      await updateSkill(row.id, { is_enabled: checked ? 1 : 0 });
      messageApi.success(checked ? "已启用" : "已禁用");
      await loadData();
    } catch (error: any) {
      messageApi.error(error?.message || "状态更新失败");
    }
  };

  const handleBatchToggleSkills = async (checked: boolean) => {
    if (!selectedSkillIds.length) {
      messageApi.warning("请先选择 Skill");
      return;
    }

    try {
      const result = await batchUpdateSkills({
        skill_ids: selectedSkillIds,
        is_enabled: checked ? 1 : 0,
      });
      messageApi.success(
        `${checked ? "批量启用" : "批量禁用"}成功，更新 ${result.updated} 个 Skill`
      );
      await loadData();
    } catch (error: any) {
      messageApi.error(error?.message || "批量更新失败");
    }
  };

  const handleBatchDeleteSkills = async () => {
    if (!selectedSkillIds.length) {
      messageApi.warning("请先选择 Skill");
      return;
    }

    try {
      const result = await batchDeleteSkills(selectedSkillIds);
      messageApi.success(`已删除 ${result.deleted} 个 Skill`);
      setSelectedSkillIds([]);
      await loadData();
    } catch (error: any) {
      messageApi.error(error?.message || "批量删除失败");
    }
  };

  useEffect(() => {
    const currentIds = skills
      .map((skill) => Number(skill.id))
      .filter((id) => Number.isInteger(id) && id > 0);
    setSelectedSkillIds((prev) => prev.filter((id) => currentIds.includes(id)));
  }, [skills]);

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
            <div className="cw-hero-content">
              <div className="cw-dashboard-eyebrow">
                <span className="cw-pulse"></span>
                Skills Library
              </div>
              <h1>技能库</h1>
              <p>
                Skill 作为全局能力开关管理。任务运行时默认使用当前用户已启用的全部 Skill。
                扩展 Agent 的专业领域能力，支持 Git 与 ZIP 导入。
              </p>
            </div>
            <div className="cw-user-card" style={{ padding: '24px 32px' }}>
              <div className="cw-user-avatar-wrap">
                <div style={{ 
                  width: 48, 
                  height: 48, 
                  background: 'linear-gradient(135deg, #f59e0b, #ef4444)', 
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff'
                }}>
                  <ThunderboltOutlined style={{ fontSize: 24 }} />
                </div>
              </div>
              <div>
                <div className="cw-user-name" style={{ fontSize: 18 }}>{skills.length} 个技能</div>
                <div className="cw-user-desc">即插即用</div>
              </div>
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
                <Space wrap>
                  <Popover
                    trigger="click"
                    placement="bottomRight"
                    content={
                      <Space direction="vertical" size={10} style={{ maxWidth: 420 }}>
                        <Typography.Text type="secondary">
                          推荐直接从这些仓库安装 Skill。
                        </Typography.Text>
                        {RECOMMENDED_SKILL_REPOS.map((repo) => (
                          <Card
                            key={repo}
                            size="small"
                            bodyStyle={{ padding: 12 }}
                          >
                            <Space
                              direction="vertical"
                              size={8}
                              style={{ width: "100%" }}
                            >
                              <Typography.Link href={repo} target="_blank">
                                {repo}
                              </Typography.Link>
                              <Button
                                size="small"
                                onClick={() => setGitRepoUrl(repo)}
                              >
                                填入安装框
                              </Button>
                            </Space>
                          </Card>
                        ))}
                      </Space>
                    }
                  >
                    <Button icon={<LinkOutlined />}>推荐 Skills</Button>
                  </Popover>
                  <Typography.Text type="secondary">
                    保留仓库和 ZIP 导入；不再提供 AI 生成或手动新增入口。
                  </Typography.Text>
                </Space>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                  gap: 16,
                }}
              >
                <Card size="small" title="Git 仓库">
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Typography.Text type="secondary">
                      输入 Skill 仓库地址。再次输入同一地址时会拉取最新内容并同步。
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
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
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
                        服务端会检查是否包含合法的 `SKILL.md`
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
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <Space>
                  <ThunderboltOutlined
                    style={{ fontSize: 20, color: "#f59e0b" }}
                  />
                  <h3 style={{ margin: 0 }}>我的技能</h3>
                </Space>
                <Space wrap>
                  <Button
                    size="small"
                    onClick={() =>
                      setSelectedSkillIds(
                        skills
                          .map((skill) => Number(skill.id))
                          .filter((id) => Number.isInteger(id) && id > 0)
                      )
                    }
                  >
                    全选
                  </Button>
                  <Button
                    size="small"
                    onClick={() => setSelectedSkillIds([])}
                  >
                    清空选择
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    disabled={!selectedSkillIds.length}
                    onClick={() => handleBatchToggleSkills(true)}
                  >
                    批量启用
                  </Button>
                  <Button
                    size="small"
                    danger
                    ghost
                    disabled={!selectedSkillIds.length}
                    onClick={() => handleBatchToggleSkills(false)}
                  >
                    批量禁用
                  </Button>
                  <Popconfirm
                    title="批量删除 Skill"
                    description={`确定删除已选中的 ${selectedSkillIds.length} 个 Skill 吗？`}
                    onConfirm={handleBatchDeleteSkills}
                    disabled={!selectedSkillIds.length}
                  >
                    <Button
                      size="small"
                      danger
                      disabled={!selectedSkillIds.length}
                    >
                      批量删除
                    </Button>
                  </Popconfirm>
                  <Typography.Text type="secondary">
                    已选择 {selectedSkillIds.length} 个
                  </Typography.Text>
                </Space>
              </div>

              <ProList<API.Skill>
                rowKey="id"
                dataSource={skills}
                loading={loading}
                metas={{
                  title: {
                    dataIndex: "name",
                    render: (text, row) => (
                      <Space wrap>
                        <Checkbox
                          checked={selectedSkillIds.includes(Number(row.id))}
                          onChange={(event) =>
                            setSelectedSkillIds((prev) =>
                              event.target.checked
                                ? Array.from(new Set([...prev, Number(row.id)]))
                                : prev.filter((id) => id !== Number(row.id))
                            )
                          }
                        />
                        <b>{text}</b>
                        {Number(row.is_enabled) === 1 ? (
                          <Tag className="cw-status-pill enabled">已启用</Tag>
                        ) : (
                          <Tag className="cw-status-pill disabled">已禁用</Tag>
                        )}
                        {row.source_type ? (
                          <Tag
                            color={row.source_type === "git" ? "green" : "gold"}
                          >
                            {row.source_type === "git" ? "Git" : "ZIP"}
                          </Tag>
                        ) : (
                          <Tag>手工</Tag>
                        )}
                      </Space>
                    ),
                  },
                  description: {
                    render: (_, row) => (
                      <Space direction="vertical" style={{ width: "100%" }}>
                        <Typography.Text>
                          {row.description || "-"}
                        </Typography.Text>
                        {row.source_location ? (
                          <Typography.Text type="secondary">
                            {row.source_location}
                          </Typography.Text>
                        ) : null}
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
                    render: (_, row) => (
                      <div className="cw-row-icon-actions">
                        <Tooltip title="编辑">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => setEditingSkill(row)}
                          />
                        </Tooltip>
                        <Tooltip title={Number(row.is_enabled) === 1 ? "禁用" : "启用"}>
                          <Button
                            type="text"
                            size="small"
                            icon={
                              Number(row.is_enabled) === 1 ? (
                                <PauseCircleOutlined />
                              ) : (
                                <PlayCircleOutlined />
                              )
                            }
                            onClick={() =>
                              handleToggleSkill(row, Number(row.is_enabled) !== 1)
                            }
                          />
                        </Tooltip>
                        <Tooltip title="删除">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={async () => {
                              await deleteSkill(row.id);
                              messageApi.success("已删除");
                              loadData();
                            }}
                          />
                        </Tooltip>
                      </div>
                    ),
                  },
                }}
              />
            </Card>
          </section>
        </main>

        <ModalForm
          title="编辑技能"
          open={!!editingSkill}
          onOpenChange={(visible) => !visible && setEditingSkill(null)}
          modalProps={{ destroyOnHidden: true }}
          initialValues={skillInitialValues}
          onFinish={async (values) => {
            if (!editingSkill?.id) {
              return false;
            }

            const payload = {
              ...values,
              tools: Array.isArray(values.tools) ? values.tools : [],
              is_enabled: values.is_enabled ? 1 : 0,
            };

            await updateSkill(editingSkill.id, payload);
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
          <ProFormSwitch
            name="is_enabled"
            label="全局启用"
            initialValue={true}
          />
        </ModalForm>
      </div>
    </ConfigProvider>
  );
};
