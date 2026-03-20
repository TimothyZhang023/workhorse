import { Sidebar } from "@/components/Sidebar";
import { InstallShareModal } from "@/components/InstallShareModal";
import { useShellPreferences } from "@/hooks/useShellPreferences";
import {
  batchDeleteMcpServers,
  batchUpdateMcpServers,
  createMcpServer,
  deleteMcpServer,
  exportMcpInstallShare,
  generateDraftFromMarketMcp,
  getDefaultMcpTemplates,
  getMcpServers,
  importDefaultMcpTemplate,
  searchMarketMcp,
  testMcpServerConnection,
  updateMcpServer,
} from "@/services/api";
import {
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  ModalForm,
  ProFormDependency,
  ProFormRadio,
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
  message,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
  Segmented,
  Form,
} from "antd";
import { useEffect, useState } from "react";
import { ChatMarketplace } from "./ChatMarketplace";
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
  const [servers, setServers] = useState<API.McpServer[]>([]);
  const [defaultTemplates, setDefaultTemplates] = useState<
    API.DefaultMcpTemplate[]
  >([]);
  const [marketQuery, setMarketQuery] = useState("");
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketServers, setMarketServers] = useState<API.MarketMcpServer[]>([]);
  const [editingServer, setEditingServer] =
    useState<Partial<API.McpServer> | null>(null);
  const [marketImportingName, setMarketImportingName] = useState<string | null>(
    null
  );
  const [testingServerId, setTestingServerId] = useState<number | null>(null);
  const [selectedServerIds, setSelectedServerIds] = useState<number[]>([]);
  const [marketMode, setMarketMode] = useState<"list" | "chat">("chat");
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLoadingServerId, setShareLoadingServerId] = useState<number | null>(null);
  const [installShare, setInstallShare] = useState<API.InstallShare | null>(null);
  const [form] = Form.useForm();

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

  useEffect(() => {
    const handleShareImport = (event: Event) => {
      const detail = (event as CustomEvent<API.InstallShareImportResult>).detail;
      if (detail?.kind === "mcp") {
        void loadData();
      }
    };

    window.addEventListener("workhorse:install-share-imported", handleShareImport);
    return () => {
      window.removeEventListener("workhorse:install-share-imported", handleShareImport);
    };
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

  const handleBatchToggleServers = async (checked: boolean) => {
    if (!selectedServerIds.length) {
      messageApi.warning("请先选择 MCP 节点");
      return;
    }

    try {
      const result = await batchUpdateMcpServers({
        server_ids: selectedServerIds,
        is_enabled: checked ? 1 : 0,
      });
      messageApi.success(
        `${checked ? "批量启用" : "批量禁用"}成功，更新 ${result.updated} 个 MCP 节点`
      );
      await loadData();
    } catch (error: any) {
      messageApi.error(error?.message || "批量更新失败");
    }
  };

  const handleBatchDeleteServers = async () => {
    if (!selectedServerIds.length) {
      messageApi.warning("请先选择 MCP 节点");
      return;
    }

    try {
      const result = await batchDeleteMcpServers(selectedServerIds);
      messageApi.success(`已删除 ${result.deleted} 个 MCP 节点`);
      setSelectedServerIds([]);
      await loadData();
    } catch (error: any) {
      messageApi.error(error?.message || "批量删除失败");
    }
  };

  useEffect(() => {
    const currentIds = servers
      .map((server) => Number(server.id))
      .filter((id) => Number.isInteger(id) && id > 0);
    setSelectedServerIds((prev) => prev.filter((id) => currentIds.includes(id)));
  }, [servers]);

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

  const handleOpenInstallShare = async (server: API.McpServer) => {
    try {
      setShareLoadingServerId(server.id);
      const share = await exportMcpInstallShare(server.id);
      setInstallShare(share);
      setShareModalOpen(true);
    } catch (error: any) {
      messageApi.error(error?.message || "导出安装链接失败");
    } finally {
      setShareLoadingServerId(null);
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
          themeMode={themeMode}
          resolvedTheme={resolvedTheme}
          setThemeMode={setThemeMode}
          activePath="/mcp"
        />

        <main className="cw-dashboard-main-wrap">
          <section className="cw-dashboard-hero">
            <div className="cw-hero-content">
              <div className="cw-dashboard-eyebrow">
                <span className="cw-pulse"></span>
                Tools & Extensions
              </div>
              <h1>MCP 管理</h1>
              <p>
                接入 Model Context Protocol (MCP)，扩展 Agent
                的原生工具调用能力。实现与外部系统、知识库及本地工具链的深度集成。
              </p>
            </div>
            <div className="cw-user-card" style={{ padding: '24px 32px' }}>
              <div className="cw-user-avatar-wrap">
                <div style={{ 
                  width: 48, 
                  height: 48, 
                  background: 'linear-gradient(135deg, #10b981, #059669)', 
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff'
                }}>
                  <ApiOutlined style={{ fontSize: 24 }} />
                </div>
              </div>
              <div>
                <div className="cw-user-name" style={{ fontSize: 18 }}>{servers.length} 个节点</div>
                <div className="cw-user-desc">已连接</div>
              </div>
            </div>
          </section>

          <section className="cw-dashboard-main">
            <Card className="cw-module-card" style={{ marginBottom: 0 }}>
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
                  <ApiOutlined style={{ fontSize: 20, color: "#10b981" }} />
                  <h3 style={{ margin: 0 }}>MCP 节点</h3>
                </Space>
                <Space wrap>
                  <Button
                    onClick={() =>
                      setSelectedServerIds(
                        servers
                          .map((server) => Number(server.id))
                          .filter((id) => Number.isInteger(id) && id > 0)
                      )
                    }
                  >
                    全选
                  </Button>
                  <Button
                    onClick={() => setSelectedServerIds([])}
                  >
                    清空选择
                  </Button>
                  <Button
                    type="primary"
                    ghost
                    disabled={!selectedServerIds.length}
                    onClick={() => handleBatchToggleServers(true)}
                  >
                    批量启用
                  </Button>
                  <Button
                    danger
                    ghost
                    disabled={!selectedServerIds.length}
                    onClick={() => handleBatchToggleServers(false)}
                  >
                    批量禁用
                  </Button>
                  <Popconfirm
                    title="批量删除 MCP 节点"
                    description={`确定删除已选中的 ${selectedServerIds.length} 个 MCP 节点吗？`}
                    onConfirm={handleBatchDeleteServers}
                    disabled={!selectedServerIds.length}
                  >
                    <Button
                      danger
                      disabled={!selectedServerIds.length}
                    >
                      批量删除
                    </Button>
                  </Popconfirm>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    style={{ background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none' }}
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
                        <Checkbox
                          checked={selectedServerIds.includes(Number(row.id))}
                          onChange={(event) =>
                            setSelectedServerIds((prev) =>
                              event.target.checked
                                ? Array.from(new Set([...prev, Number(row.id)]))
                                : prev.filter((id) => id !== Number(row.id))
                            )
                          }
                        />
                        <b>{text}</b>
                        <Tag color={row.type === "stdio" ? "blue" : "purple"}>
                          {row.type}
                        </Tag>
                        {row.is_enabled === 1 ? (
                          <Tag className="cw-status-pill enabled">已启用</Tag>
                        ) : (
                          <Tag className="cw-status-pill disabled">已禁用</Tag>
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
                    render: (_, row) => (
                      <div className="cw-row-icon-actions">
                        <Tooltip title="测试连接">
                          <Button
                            type="text"
                            size="small"
                            icon={<LinkOutlined />}
                            loading={testingServerId === row.id}
                            onClick={() => handleTestConnection(row.id)}
                          />
                        </Tooltip>
                        <Tooltip title={row.is_enabled === 1 ? "禁用" : "启用"}>
                          <Button
                            type="text"
                            size="small"
                            icon={
                              row.is_enabled === 1 ? (
                                <PauseCircleOutlined />
                              ) : (
                                <PlayCircleOutlined />
                              )
                            }
                            onClick={() =>
                              handleToggleEnable(row, row.is_enabled !== 1)
                            }
                          />
                        </Tooltip>
                        <Tooltip title="编辑">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => setEditingServer(row)}
                          />
                        </Tooltip>
                        <Tooltip title="分享安装">
                          <Button
                            type="text"
                            size="small"
                            icon={<ExportOutlined />}
                            loading={shareLoadingServerId === row.id}
                            onClick={() => handleOpenInstallShare(row)}
                          />
                        </Tooltip>
                        <Tooltip title="删除">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => handleDelete(row.id)}
                          />
                        </Tooltip>
                      </div>
                    ),
                  },
                }}
              />
            </Card>

            <div style={{ 
              display: 'flex', 
              justifyContent: 'center',
              padding: '4px',
              background: isDark ? 'rgba(30, 41, 59, 0.4)' : 'rgba(255, 255, 255, 0.5)',
              borderRadius: '12px',
              width: 'fit-content',
              margin: '8px auto 20px',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.05)'
            }}>
              <Segmented
                size="large"
                block
                options={[
                  { label: '对话发现 (AI)', value: 'chat', icon: <ThunderboltOutlined /> },
                  { label: '列表搜索', value: 'list', icon: <SearchOutlined /> },
                ]}
                value={marketMode}
                onChange={(value) => setMarketMode(value as any)}
              />
            </div>

            {marketMode === "chat" ? (
              <ChatMarketplace 
                onImport={handleGenerateFromMarket}
                importingName={marketImportingName}
              />
            ) : (
              <>
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
              </>
            )}
          </section>
        </main>

        <ModalForm
          title={editingServer?.id ? "编辑 MCP 服务器" : "添加 MCP 服务器"}
          open={!!editingServer}
          form={form}
          onOpenChange={(visible) => {
            if (!visible) {
              setEditingServer(null);
              form.resetFields();
            }
          }}
          modalProps={{ 
            destroyOnHidden: true,
            width: 720,
            bodyStyle: { paddingTop: 24 }
          }}
          initialValues={editingServerInitialValues}
          onValuesChange={(changedValues) => {
            if (changedValues.raw_json) {
              try {
                const parsed = JSON.parse(changedValues.raw_json);
                const updates: any = {};
                
                if (parsed.name) updates.name = parsed.name;
                if (parsed.type) updates.type = parsed.type;
                if (parsed.command) updates.command = parsed.command;
                if (parsed.url) updates.url = parsed.url;
                
                if (parsed.args) {
                  updates.args = Array.isArray(parsed.args) 
                    ? parsed.args.join(" ") 
                    : parsed.args;
                }
                
                if (parsed.env) updates.env = stringifyJsonForEditor(parsed.env);
                if (parsed.headers) updates.headers = stringifyJsonForEditor(parsed.headers);
                if (parsed.auth) updates.auth = stringifyJsonForEditor(parsed.auth);
                
                form.setFieldsValue(updates);
              } catch (e) {
                // Ignore parsing errors while typing
              }
            }
          }}
          onFinish={async (values) => {
            try {
              let formValues = { ...values };
              const rawJson = String(formValues.raw_json || "").trim();
              if (rawJson) {
                try {
                  formValues = {
                    ...formValues,
                    ...JSON.parse(rawJson),
                  };
                } catch {
                  messageApi.error("JSON 直填配置格式不正确");
                  return false;
                }
              }

              // Normalizing args
              if (typeof formValues.args === "string") {
                formValues.args = formValues.args
                  .split(/\s+/)
                  .filter((s: string) => s.length > 0);
              }

              // Parsing optional JSON fields
              try {
                formValues.env = parseOptionalJsonText(
                  formValues.env,
                  null,
                  "环境变量"
                );
                formValues.headers = parseOptionalJsonText(
                  formValues.headers,
                  null,
                  "HTTP 请求头"
                );
                formValues.auth = parseOptionalJsonText(
                  formValues.auth,
                  null,
                  "认证配置"
                );
              } catch (e: any) {
                messageApi.error(e.message);
                return false;
              }

              if (editingServer?.id) {
                await updateMcpServer(editingServer.id, formValues);
                messageApi.success("修改成功");
              } else {
                await createMcpServer(formValues);
                messageApi.success("添加成功");
              }
              loadData();
              return true;
            } catch (error: any) {
              messageApi.error(error?.message || "操作失败");
              return false;
            }
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <ProFormText
              name="name"
              label="服务器名称"
              placeholder="例如: github-mcp"
              rules={[{ required: true }]}
            />
            <ProFormRadio.Group
              name="type"
              label="服务器类型"
              options={[
                { label: "stdio", value: "stdio" },
                { label: "sse", value: "sse" },
              ]}
              rules={[{ required: true }]}
            />
          </div>

          <ProFormDependency name={["type"]}>
            {({ type }) => {
              if (type === "stdio") {
                return (
                  <>
                    <ProFormText
                      name="command"
                      label="启动命令"
                      placeholder="node / npx / python ..."
                      rules={[{ required: true }]}
                    />
                    <ProFormTextArea
                      name="args"
                      label="参数 (空格分隔)"
                      placeholder="例如: @modelcontextprotocol/server-github"
                    />
                  </>
                );
              }
              return (
                <ProFormText
                  name="url"
                  label="SSE Endpoint URL"
                  placeholder="http://localhost:3001/sse"
                  rules={[{ required: true }]}
                />
              );
            }}
          </ProFormDependency>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <ProFormTextArea
              name="env"
              label="环境变量 (JSON)"
              placeholder='{"GITHUB_PERSONAL_ACCESS_TOKEN": "..."}'
              fieldProps={{ autoSize: { minRows: 2, maxRows: 6 } }}
            />
            <ProFormTextArea
              name="headers"
              label="HTTP 请求头 (JSON)"
              placeholder='{"Authorization": "Bearer ..."}'
              fieldProps={{ autoSize: { minRows: 2, maxRows: 6 } }}
            />
          </div>

          <ProFormTextArea
            name="auth"
            label="认证配置 (JSON)"
            placeholder='{"token": "..."}'
            fieldProps={{ autoSize: { minRows: 2, maxRows: 4 } }}
          />

          <ProFormSwitch name="is_enabled" label="启用当前节点" />

          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", color: "#666", fontSize: 13 }}>
              高级：直接填入 JSON 配置 (会覆盖上方字段)
            </summary>
            <ProFormTextArea
              name="raw_json"
              placeholder='{"command": "npx", "args": ["..."], "env": {...}}'
              fieldProps={{ autoSize: { minRows: 3, maxRows: 10 } }}
            />
          </details>
        </ModalForm>
        <InstallShareModal
          open={shareModalOpen}
          share={installShare}
          onClose={() => {
            setShareModalOpen(false);
            setInstallShare(null);
          }}
        />
      </div>
    </ConfigProvider>
  );
};
