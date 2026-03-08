import { AccountModal } from "@/components/AccountModal";
import { SettingsModal } from "@/components/SettingsModal";
import { Sidebar } from "@/components/Sidebar";
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServers,
  updateMcpServer,
} from "@/services/api";
import { PlusOutlined, ApiOutlined } from "@ant-design/icons";
import {
  ModalForm,
  ProFormRadio,
  ProFormSwitch,
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
  Form
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
  const [servers, setServers] = useState<API.McpServer[]>([]);
  const [editingServer, setEditingServer] = useState<API.McpServer | null>(
    null
  );

  const isDark = theme === "dark";

  const loadServers = async () => {
    setLoading(true);
    try {
      const data = await getMcpServers();
      setServers(data);
    } catch (error) {
      console.error(error);
      message.error("获取 MCP 服务器列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServers();
  }, []);

  const handleDelete = async (id: number) => {
    try {
      await deleteMcpServer(id);
      message.success("删除成功");
      loadServers();
    } catch (error) {
      message.error("删除失败");
    }
  };

  const handleToggleEnable = async (row: API.McpServer, checked: boolean) => {
    try {
      await updateMcpServer(row.id, { is_enabled: checked ? 1 : 0 });
      message.success(checked ? "已启用" : "已禁用");
      loadServers();
    } catch (error) {
      message.error("状态修改失败");
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
          setShowAccount={setShowAccount}
          setShowSettings={setShowSettings}
        />

        <main className="cw-dashboard-main-wrap">
          <section className="cw-dashboard-hero">
            <div>
              <div className="cw-dashboard-eyebrow">Tools</div>
              <h1>MCP 管理</h1>
              <p>接入 Model Context Protocol (MCP)，扩展 Agent 的原生工具调用能力与外部系统集成。</p>
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
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditingServer({ type: "stdio", is_enabled: 1 } as API.McpServer);
                  }}
                >
                  添加 MCP 服务器
                </Button>
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
                        return <div>命令: {row.command} {row.args?.join(" ") || ""}</div>;
                      }
                      return <div>URL: {row.url}</div>;
                    },
                  },
                  actions: {
                    render: (_, row) => [
                      <a
                        key="toggle"
                        onClick={() => handleToggleEnable(row, row.is_enabled === 0)}
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
          </section>
        </main>

        <ModalForm
          title={editingServer?.id ? "编辑 MCP 服务器" : "添加 MCP 服务器"}
          open={!!editingServer}
          onOpenChange={(visible) => !visible && setEditingServer(null)}
          modalProps={{ destroyOnClose: true }}
          initialValues={editingServer || {}}
          onFinish={async (values) => {
            try {
              const formValues = { ...values };
              if (formValues.type === "stdio" && typeof formValues.args === "string") {
                formValues.args = formValues.args.trim().split(/\s+/).filter(Boolean);
              }
              if (formValues.type === "stdio" && !formValues.command) {
                message.error("本地命令行必须填写可执行命令");
                return false;
              }
              if (formValues.type === "sse" && !formValues.url) {
                message.error("远程服务必须填写 URL");
                return false;
              }

              if (formValues.headers && typeof formValues.headers === "string") {
                try {
                  formValues.headers = JSON.parse(formValues.headers);
                } catch (e) {
                  message.error("Headers JSON 格式不正确");
                  return false;
                }
              }
              if (formValues.auth && typeof formValues.auth === "string") {
                try {
                  formValues.auth = JSON.parse(formValues.auth);
                } catch (e) {
                  message.error("Auth JSON 格式不正确");
                  return false;
                }
              }

              formValues.is_enabled = formValues.is_enabled ? 1 : 0;

              if (editingServer?.id) {
                await updateMcpServer(editingServer.id, formValues);
              } else {
                await createMcpServer(formValues);
              }
              message.success("保存成功");
              loadServers();
              setEditingServer(null);
              return true;
            } catch (error) {
              console.error(error);
              message.error("保存失败");
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
                      transform={(val) => {
                        if (Array.isArray(val)) return val.join(" ");
                        return val;
                      }}
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
            name="headers"
            label="自定义 Headers (JSON)"
            placeholder='{"Authorization": "Bearer ...", "X-Custom": "Value"}'
            transform={(val: any) =>
              typeof val === "object" ? JSON.stringify(val, null, 2) : val
            }
          />

          <ProFormTextArea
            name="auth"
            label="认证信息 (JSON)"
            placeholder='{"type": "bearer", "token": "..."} 或 {"type": "basic", "username": "...", "password": "..."}'
            transform={(val: any) =>
              typeof val === "object" ? JSON.stringify(val, null, 2) : val
            }
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
