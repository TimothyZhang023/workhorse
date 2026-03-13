import { Sidebar } from "@/components/Sidebar";
import {
  createMcpServer,
  deleteMcpServer,
  generateMcpDraft,
  getDefaultMcpTemplates,
  getMcpServers,
  generateDraftFromMarketMcp,
  importDefaultMcpTemplate,
  searchMarketMcp,
  testMcpServerConnection,
  updateMcpServer,
} from "@/services/api";
import { PlusOutlined, ApiOutlined, RobotOutlined } from "@ant-design/icons";
import {
  ModalForm,
  ProFormRadio,
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
  Input,
  message,
  Space,
  Tag,
  Form,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import "../Dashboard/index.css";

const stringifyJsonForEditor = (value: unknown) => {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const parseOptionalJsonText = (
  value: unknown,
  fallbackValue: Record<string, string> | null,
  label: string
) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return fallbackValue;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} JSON 格式不正确`);
  }
};

export default () => {
  const { currentUser, isLoggedIn } = useAppStore();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [moduleExpanded, setModuleExpanded] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [loading, setLoading] = useState(false);
  const [servers, setServers] = useState<API.McpServer[]>([]);
  const [defaultTemplates, setDefaultTemplates] = useState<
    API.DefaultMcpTemplate[]
  >([]);
  const [marketQuery, setMarketQuery] = useState("");
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketServers, setMarketServers] = useState<API.MarketMcpServer[]>([]);
  const [editingServer, setEditingServer] =
    useState<Partial<API.McpServer> | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [marketImportingName, setMarketImportingName] = useState<string | null>(
    null
  );
  const [testingServerId, setTestingServerId] = useState<number | null>(null);

  const isDark = theme === "dark";

  const loadData = async () => {
    setLoading(true);
    try {
      const [serverData, templateData] = await Promise.all([
        getMcpServers(),
        getDefaultMcpTemplates(),
      ]);
      setServers(serverData);
      setDefaultTemplates(templateData);
    } catch (error) {
      console.error(error);
      messageApi.error("获取 MCP 数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const editingServerInitialValues = editingServer
    ? {
        ...editingServer,
        args: Array.isArray(editingServer.args)
          ? editingServer.args.join(" ")
          : editingServer.args,
        env: stringifyJsonForEditor(editingServer.env),
        headers: stringifyJsonForEditor(editingServer.headers),
        auth: stringifyJsonForEditor(editingServer.auth),
        is_enabled: editingServer.is_enabled === 1,
      }
    : {};

  const handleDelete = async (id: number) => {
    try {
      await deleteMcpServer(id);
      messageApi.success("删除成功");
      loadData();
    } catch (error) {
      messageApi.error("删除失败");
    }
  };

  const handleToggleEnable = async (row: API.McpServer, checked: boolean) => {
    try {
      await updateMcpServer(row.id, { is_enabled: checked ? 1 : 0 });
      messageApi.success(checked ? "已启用" : "已禁用");
      loadData();
    } catch (error) {
      messageApi.error("状态修改失败");
    }
  };

  const handleImportDefaultTemplate = async (templateId: string) => {
    try {
      const result = await importDefaultMcpTemplate(templateId);
      messageApi.success(
        result.template.needs_configuration
          ? "模板已导入，请补充配置后启用"
          : "模板已导入"
      );
      await loadData();
      setEditingServer(result.server);
      if (!hasServerPlaceholders(result.server)) {
        await handleTestConnection(result.server.id);
      }
    } catch (error: any) {
      messageApi.error(
        error?.response?.data?.error ||
          error?.data?.error ||
          error?.message ||
          "导入模板失败"
      );
    }
  };

  const handleSearchMarket = async (query = marketQuery) => {
    const normalized = String(query || "").trim();
    if (!normalized) {
      setMarketServers([]);
      return;
    }

    try {
      setMarketLoading(true);
      const results = await searchMarketMcp(normalized);
      setMarketServers(results);
    } catch (error: any) {
      messageApi.error(
        error?.response?.data?.error ||
          error?.data?.error ||
          error?.message ||
          "市场 MCP 搜索失败"
      );
    } finally {
      setMarketLoading(false);
    }
  };

  const handleGenerateFromMarket = async (
    serverName: string,
    autoCreate = false
  ) => {
    try {
      setMarketImportingName(serverName);
      const result = await generateDraftFromMarketMcp({
        server_name: serverName,
        auto_create: autoCreate,
      });

      if (result.server) {
        messageApi.success("市场 MCP 已导入");
        await loadData();
        setEditingServer(result.server);
        if (!hasServerPlaceholders(result.server)) {
          await handleTestConnection(result.server.id);
        }
        return;
      }

      setEditingServer({
        ...result.draft,
        is_enabled:
          typeof result.draft?.is_enabled === "number"
            ? result.draft.is_enabled
            : 0,
      });
      messageApi.success("已生成市场 MCP 接入草稿");
    } catch (error: any) {
      messageApi.error(
        error?.response?.data?.error ||
          error?.data?.error ||
          error?.message ||
          "生成市场 MCP 草稿失败"
      );
    } finally {
      setMarketImportingName(null);
    }
  };

  const hasServerPlaceholders = (server: Partial<API.McpServer> | null) => {
    if (!server) return true;

    const inspectValues = [
      ...(Array.isArray(server.args) ? server.args : []),
      ...Object.values(server.env || {}),
      ...Object.values(server.headers || {}),
      server.url || "",
      server.command || "",
      server.auth?.token || "",
      server.auth?.username || "",
      server.auth?.password || "",
    ]
      .map((item) => String(item || ""))
      .join(" ");

    return /YOUR_|\/path\/to\/|postgres:\/\/user:password|example\.com|localhost:3001/i.test(
      inspectValues
    );
  };

  const handleTestConnection = async (serverId: number) => {
    try {
      setTestingServerId(serverId);
      const result = await testMcpServerConnection(serverId);
      messageApi.success(
        `连接成功，发现 ${result.tool_count} 个工具${
          result.tool_names.length ? `：${result.tool_names.join(", ")}` : ""
        }`
      );
    } catch (error: any) {
      messageApi.error(
        error?.response?.data?.error ||
          error?.data?.error ||
          error?.message ||
          "测试连接失败"
      );
    } finally {
      setTestingServerId(null);
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
      <div
        className={`cw-dashboard-layout ${isDark ? "dark" : ""}`}
        style={{ height: "100vh" }}
      >
        <Sidebar
          moduleExpanded={moduleExpanded}
          setModuleExpanded={setModuleExpanded}
          theme={theme}
          setTheme={setTheme}
          activePath="/mcp"
        />

        <main className="cw-dashboard-main-wrap">
          <section className="cw-dashboard-hero">
            <div>
              <div className="cw-dashboard-eyebrow">Tools</div>
              <h1>MCP 管理</h1>
              <p>
                接入 Model Context Protocol (MCP)，扩展 Agent
                的原生工具调用能力与外部系统集成。
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
                  <ApiOutlined style={{ fontSize: 20, color: "#10b981" }} />
                  <h3 style={{ margin: 0 }}>MCP 节点</h3>
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
                    onClick={() => {
                      setEditingServer({ type: "stdio", is_enabled: 1 });
                    }}
                  >
                    添加 MCP 服务器
                  </Button>
                </Space>
              </div>

              <ProList<API.McpServer>
                rowKey="id"
                dataSource={servers}
                loading={loading}
                metas={{
                  title: {
                    dataIndex: "name",
                    render: (text, row) => (
                      <Space>
                        <b>{text}</b>
                        <Tag color={row.type === "stdio" ? "blue" : "purple"}>
                          {row.type}
                        </Tag>
                        {row.is_enabled === 1 ? (
                          <Tag color="success">已启用</Tag>
                        ) : (
                          <Tag color="default">已禁用</Tag>
                        )}
                      </Space>
                    ),
                  },
                  description: {
                    render: (_, row) => {
                      if (row.type === "stdio") {
                        return (
                          <div>
                            命令: {row.command} {row.args?.join(" ") || ""}
                          </div>
                        );
                      }
                      return <div>URL: {row.url}</div>;
                    },
                  },
                  actions: {
                    render: (_, row) => [
                      <a
                        key="test"
                        onClick={() => handleTestConnection(row.id)}
                      >
                        {testingServerId === row.id ? "测试中..." : "测试连接"}
                      </a>,
                      <a
                        key="toggle"
                        onClick={() =>
                          handleToggleEnable(row, row.is_enabled === 0)
                        }
                      >
                        {row.is_enabled === 1 ? "禁用" : "启用"}
                      </a>,
                      <a key="edit" onClick={() => setEditingServer(row)}>
                        编辑
                      </a>,
                      <a
                        key="delete"
                        onClick={() => handleDelete(row.id)}
                        style={{ color: "red" }}
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
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    平台默认 MCP
                  </Typography.Title>
                  <Tag color="gold">可一键导入</Tag>
                </Space>
                <Typography.Text type="secondary">
                  常用官方/通用模板，导入后可继续编辑
                </Typography.Text>
              </div>

              <ProList<API.DefaultMcpTemplate>
                rowKey="id"
                dataSource={defaultTemplates}
                loading={loading}
                metas={{
                  title: {
                    render: (_, row) => (
                      <Space wrap>
                        <b>{row.name}</b>
                        <Tag color="blue">{row.category}</Tag>
                        <Tag color={row.type === "stdio" ? "cyan" : "purple"}>
                          {row.type}
                        </Tag>
                        {row.needs_configuration ? (
                          <Tag color="orange">需配置</Tag>
                        ) : (
                          <Tag color="success">可直接导入</Tag>
                        )}
                      </Space>
                    ),
                  },
                  description: {
                    render: (_, row) => (
                      <Space direction="vertical" style={{ width: "100%" }}>
                        <Typography.Text>{row.description}</Typography.Text>
                        <Typography.Text type="secondary">
                          {row.type === "stdio"
                            ? `命令: ${row.command} ${(row.args || []).join(
                                " "
                              )}`
                            : `URL: ${row.url || "-"}`}
                        </Typography.Text>
                        {row.source_url ? (
                          <Typography.Link
                            href={row.source_url}
                            target="_blank"
                          >
                            查看来源
                          </Typography.Link>
                        ) : null}
                      </Space>
                    ),
                  },
                  actions: {
                    render: (_, row) => [
                      <Button
                        key="import"
                        type="link"
                        onClick={() => handleImportDefaultTemplate(row.id)}
                      >
                        导入
                      </Button>,
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
                  gap: 12,
                }}
              >
                <Space>
                  <Typography.Title level={4} style={{ margin: 0 }}>
                    MCP 市场
                  </Typography.Title>
                  <Tag color="magenta">Registry</Tag>
                </Space>
                <Space.Compact style={{ width: 520, maxWidth: "100%" }}>
                  <Input
                    value={marketQuery}
                    onChange={(event) => setMarketQuery(event.target.value)}
                    placeholder="搜索市场 MCP，例如 github / postgres / browser / slack"
                    onPressEnter={() => handleSearchMarket()}
                  />
                  <Button
                    loading={marketLoading}
                    onClick={() => handleSearchMarket()}
                  >
                    搜索
                  </Button>
                </Space.Compact>
              </div>

              <ProList<API.MarketMcpServer>
                rowKey="name"
                dataSource={marketServers}
                loading={marketLoading}
                locale={{ emptyText: "输入关键词后搜索官方 MCP Registry" }}
                metas={{
                  title: {
                    render: (_, row) => (
                      <Space wrap>
                        <b>{row.title || row.name}</b>
                        {row.transport ? (
                          <Tag color="geekblue">{row.transport}</Tag>
                        ) : null}
                        {row.package_identifier ? (
                          <Tag color="cyan">stdio package</Tag>
                        ) : null}
                        {row.remote_url ? (
                          <Tag color="purple">remote</Tag>
                        ) : null}
                      </Space>
                    ),
                  },
                  description: {
                    render: (_, row) => (
                      <Space direction="vertical" style={{ width: "100%" }}>
                        <Typography.Text>
                          {row.description || "-"}
                        </Typography.Text>
                        {row.package_identifier ? (
                          <Typography.Text type="secondary">
                            Package: {row.package_identifier}
                          </Typography.Text>
                        ) : null}
                        {row.remote_url ? (
                          <Typography.Text type="secondary">
                            Remote: {row.remote_url}
                          </Typography.Text>
                        ) : null}
                        {row.repository_url ? (
                          <Typography.Link
                            href={row.repository_url}
                            target="_blank"
                          >
                            查看仓库
                          </Typography.Link>
                        ) : null}
                      </Space>
                    ),
                  },
                  actions: {
                    render: (_, row) => [
                      <Button
                        key="draft"
                        type="link"
                        loading={marketImportingName === row.name}
                        onClick={() =>
                          handleGenerateFromMarket(row.name, false)
                        }
                      >
                        生成接入草稿
                      </Button>,
                      <Button
                        key="import"
                        type="link"
                        loading={marketImportingName === row.name}
                        onClick={() => handleGenerateFromMarket(row.name, true)}
                      >
                        直接导入
                      </Button>,
                    ],
                  },
                }}
              />
            </Card>
          </section>
        </main>

        <ModalForm
          title={editingServer?.id ? "编辑 MCP 服务器" : "添加 MCP 服务器"}
          open={!!editingServer}
          onOpenChange={(visible) => !visible && setEditingServer(null)}
          modalProps={{ destroyOnHidden: true }}
          initialValues={editingServerInitialValues}
          onFinish={async (values) => {
            try {
              const formValues = { ...values };
              if (
                formValues.type === "stdio" &&
                typeof formValues.args === "string"
              ) {
                formValues.args = formValues.args
                  .trim()
                  .split(/\s+/)
                  .filter(Boolean);
              }
              if (formValues.type === "stdio" && !formValues.command) {
                messageApi.error("本地命令行必须填写可执行命令");
                return false;
              }
              if (formValues.type === "sse" && !formValues.url) {
                messageApi.error("远程服务必须填写 URL");
                return false;
              }

              formValues.headers = parseOptionalJsonText(
                formValues.headers,
                {},
                "Headers"
              );
              formValues.env = parseOptionalJsonText(formValues.env, {}, "Env");
              formValues.auth = parseOptionalJsonText(
                formValues.auth,
                null,
                "Auth"
              );

              formValues.is_enabled = formValues.is_enabled ? 1 : 0;

              if (editingServer?.id) {
                await updateMcpServer(editingServer.id, formValues);
              } else {
                await createMcpServer(formValues);
              }
              messageApi.success("保存成功");
              loadData();
              setEditingServer(null);
              return true;
            } catch (error: any) {
              console.error(error);
              messageApi.error(error?.message || "保存失败");
              return false;
            }
          }}
        >
          <ProFormText
            name="name"
            label="名称"
            placeholder="如：Postgres Database"
            rules={[{ required: true }]}
          />
          <ProFormRadio.Group
            name="type"
            label="连接类型"
            options={[
              { label: "本地命令 (stdio)", value: "stdio" },
              { label: "远程服务 (sse)", value: "sse" },
            ]}
            rules={[{ required: true }]}
          />

          <Form.Item
            noStyle
            shouldUpdate={(prevValues, currentValues) =>
              prevValues.type !== currentValues.type
            }
          >
            {({ getFieldValue }) => {
              const type = getFieldValue("type");
              if (type === "stdio") {
                return (
                  <>
                    <ProFormText
                      name="command"
                      label="可执行命令"
                      placeholder="如：npx, python, docker"
                      rules={[{ required: true }]}
                    />
                    <ProFormText
                      name="args"
                      label="运行参数"
                      placeholder="如：-y @modelcontextprotocol/server-postgres postgres://... (用空格分隔)"
                    />
                  </>
                );
              } else if (type === "sse") {
                return (
                  <ProFormText
                    name="url"
                    label="SSE URL"
                    placeholder="如：http://localhost:3001/sse"
                    rules={[{ required: true }]}
                  />
                );
              }
              return null;
            }}
          </Form.Item>

          <ProFormTextArea
            name="env"
            label="环境变量 (JSON)"
            placeholder='{"GITHUB_TOKEN": "YOUR_GITHUB_TOKEN"}'
            fieldProps={{
              rows: 4,
            }}
          />

          <ProFormTextArea
            name="headers"
            label="自定义 Headers (JSON)"
            placeholder='{"Authorization": "Bearer ...", "X-Custom": "Value"}'
            fieldProps={{
              rows: 4,
            }}
          />

          <ProFormTextArea
            name="auth"
            label="认证信息 (JSON)"
            placeholder='{"type": "bearer", "token": "..."} 或 {"type": "basic", "username": "...", "password": "..."}'
            fieldProps={{
              rows: 3,
            }}
          />

          <ProFormSwitch
            name="is_enabled"
            label="启用此服务"
            initialValue={true}
          />
        </ModalForm>

        <ModalForm
          title="AI 生成 MCP 接入"
          open={generatorOpen}
          onOpenChange={setGeneratorOpen}
          modalProps={{ destroyOnHidden: true }}
          initialValues={{ auto_create: false }}
          onFinish={async (values) => {
            try {
              const result = await generateMcpDraft({
                requirement: String(values.requirement || "").trim(),
                auto_create: Boolean(values.auto_create),
              });

              if (result.server) {
                messageApi.success(
                  `已使用 ${result.model || "默认模型"} 自动接入 MCP`
                );
                loadData();
                setGeneratorOpen(false);
                return true;
              }

              setEditingServer({
                ...result.draft,
                is_enabled:
                  typeof result.draft?.is_enabled === "number"
                    ? result.draft.is_enabled
                    : 1,
              });
              messageApi.success(
                `已生成 MCP 草稿，来自 ${result.endpoint || "默认 Endpoint"}`
              );
              setGeneratorOpen(false);
              return true;
            } catch (error: any) {
              messageApi.error(
                error?.response?.data?.error ||
                  error?.data?.error ||
                  error?.message ||
                  "MCP 生成失败"
              );
              return false;
            }
          }}
        >
          <ProFormTextArea
            name="requirement"
            label="自然语言接入需求"
            placeholder="例如：帮我接入 GitHub MCP，本地用 npx 启动，包名是 @modelcontextprotocol/server-github，需要 Bearer Token。"
            rules={[{ required: true, message: "请输入 MCP 接入描述" }]}
            fieldProps={{ rows: 6 }}
          />
          <ProFormSwitch
            name="auto_create"
            label="生成后直接接入"
            checkedChildren="直接接入"
            unCheckedChildren="仅生成草稿"
          />
        </ModalForm>
      </div>
    </ConfigProvider>
  );
};
