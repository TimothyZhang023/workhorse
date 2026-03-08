import {
  BarChartOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  KeyOutlined,
  LinkOutlined,
  NotificationOutlined,
  PlusOutlined,
  StopOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { request, useModel } from "@umijs/max";
import {
  Alert,
  message as antdMessage,
  Button,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";

const { Text } = Typography;

// 预估模型价格（$/1M tokens）
const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4": { input: 30, output: 60 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "claude-3-5-sonnet": { input: 3, output: 15 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  "claude-3-opus": { input: 15, output: 75 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
};

function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const key = Object.keys(MODEL_PRICES).find((k) =>
    model.toLowerCase().includes(k)
  );
  if (!key) return 0;
  const p = MODEL_PRICES[key];
  return (promptTokens * p.input + completionTokens * p.output) / 1_000_000;
}

interface UsageSummaryData {
  totals: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_requests: number;
    models_used: number;
    active_days: number;
  };
  byModel: Array<{ model: string; total_tokens: number; requests: number }>;
  daily: Array<{
    date: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    requests: number;
  }>;
}

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  is_active: number;
  last_used_at: string | null;
  created_at: string;
}

interface User {
  uid: string;
  username: string;
  role: string;
  created_at: string;
}

interface Webhook {
  id: number;
  name: string;
  url: string;
  events: string[];
  is_active: number;
  created_at: string;
}

interface AccountModalProps {
  open: boolean;
  onClose: () => void;
  isDark: boolean;
}

export const AccountModal = ({ open, onClose, isDark }: AccountModalProps) => {
  const { currentUser } = useModel("global");
  const isAdmin = (currentUser as any)?.role === "admin";

  const [activeTab, setActiveTab] = useState("usage");
  const [days, setDays] = useState(30);
  const [usage, setUsage] = useState<UsageSummaryData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  // Admin states
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // Webhook states
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [wbForm] = Form.useForm();

  useEffect(() => {
    if (open) {
      if (activeTab === "usage") loadUsage();
      if (activeTab === "apikeys") loadApiKeys();
      if (activeTab === "webhooks") loadWebhooks();
      if (activeTab === "admin" && isAdmin) loadUsers();
    }
  }, [open, days, activeTab]);

  const loadWebhooks = async () => {
    setWebhooksLoading(true);
    try {
      const data = await request<Webhook[]>("/api/account/webhooks");
      setWebhooks(data);
    } catch (e) {
      console.error(e);
    }
    setWebhooksLoading(false);
  };

  const loadUsage = async () => {
    setUsageLoading(true);
    try {
      const data = await request<UsageSummaryData>(
        `/api/account/summary?days=${days}`
      );
      setUsage(data);
    } catch (e) {
      console.error(e);
    }
    setUsageLoading(false);
  };

  const loadApiKeys = async () => {
    setKeysLoading(true);
    try {
      const data = await request<ApiKey[]>("/api/account/api-keys");
      setApiKeys(data);
    } catch (e) {
      console.error(e);
    }
    setKeysLoading(false);
  };

  const loadUsers = async () => {
    setUsersLoading(true);
    try {
      const data = await request<User[]>("/api/admin/users");
      setUsers(data);
    } catch (e) {
      console.error(e);
    }
    setUsersLoading(false);
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const result = await request<{ key: string; name: string }>(
        "/api/account/api-keys",
        {
          method: "POST",
          data: { name: newKeyName.trim() },
        }
      );
      setNewlyCreatedKey(result.key);
      setNewKeyName("");
      loadApiKeys();
    } catch (e: any) {
      antdMessage.error(e.message || "创建失败");
    }
    setCreating(false);
  };

  const handleRevokeKey = async (id: string) => {
    try {
      await request(`/api/account/api-keys/${id}/revoke`, { method: "PUT" });
      antdMessage.success("已吊销");
      loadApiKeys();
    } catch (e) {
      antdMessage.error("操作失败");
    }
  };

  const handleDeleteKey = async (id: string) => {
    try {
      await request(`/api/account/api-keys/${id}`, { method: "DELETE" });
      antdMessage.success("已删除");
      loadApiKeys();
    } catch (e) {
      antdMessage.error("删除失败");
    }
  };

  const handleUpdateRole = async (uid: string, role: string) => {
    try {
      await request(`/api/admin/users/${uid}/role`, {
        method: "PUT",
        data: { role },
      });
      antdMessage.success("角色已更新");
      loadUsers();
    } catch (e: any) {
      antdMessage.error(e.message || "更新失败");
    }
  };

  const handleDeleteUser = async (uid: string) => {
    try {
      await request(`/api/admin/users/${uid}`, { method: "DELETE" });
      antdMessage.success("用户已删除");
      loadUsers();
    } catch (e: any) {
      antdMessage.error(e.message || "删除失败");
    }
  };

  const handleAddWebhook = async (values: any) => {
    try {
      await request("/api/account/webhooks", {
        method: "POST",
        data: values,
      });
      antdMessage.success("Webhook 已添加");
      setShowAddWebhook(false);
      wbForm.resetFields();
      loadWebhooks();
    } catch (e: any) {
      antdMessage.error(e.message || "添加失败");
    }
  };

  const handleDeleteWebhook = async (id: number) => {
    try {
      await request(`/api/account/webhooks/${id}`, { method: "DELETE" });
      antdMessage.success("已删除");
      loadWebhooks();
    } catch (e) {
      antdMessage.error("删除失败");
    }
  };

  const handleToggleWebhook = async (id: number, isActive: boolean) => {
    try {
      await request(`/api/account/webhooks/${id}/status`, {
        method: "PUT",
        data: { isActive: !isActive },
      });
      loadWebhooks();
    } catch (e) {
      antdMessage.error("转换失败");
    }
  };

  const totals = usage?.totals;
  const totalCost =
    usage?.byModel?.reduce(
      (acc, row) =>
        acc +
        estimateCost(row.model, row.total_tokens * 0.4, row.total_tokens * 0.6),
      0
    ) || 0;

  const usageTab = (
    <div>
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13, color: "#6b7280" }}>最近</span>
        <Select
          value={days}
          onChange={setDays}
          options={[
            { label: "7 天", value: 7 },
            { label: "30 天", value: 30 },
            { label: "90 天", value: 90 },
          ]}
          style={{ width: 100 }}
          size="small"
        />
        <Button size="small" onClick={loadUsage}>
          刷新
        </Button>
      </div>

      {/* 总览卡片 */}
      <Row gutter={12} style={{ marginBottom: 24 }}>
        {[
          {
            title: "总 Token 数",
            value: totals?.total_tokens ?? 0,
            suffix: "tokens",
            color: "#3b82f6",
          },
          {
            title: "请求次数",
            value: totals?.total_requests ?? 0,
            suffix: "次",
            color: "#8b5cf6",
          },
          {
            title: "活跃天数",
            value: totals?.active_days ?? 0,
            suffix: "天",
            color: "#10b981",
          },
          {
            title: "预估费用",
            value: `$${totalCost.toFixed(4)}`,
            suffix: "USD",
            color: "#f59e0b",
            isString: true,
          },
        ].map((item) => (
          <Col span={6} key={item.title}>
            <div
              style={{
                padding: "16px",
                borderRadius: 10,
                border: `1px solid ${isDark ? "#2d3748" : "#e5e7eb"}`,
                background: isDark ? "#1e293b" : "#f9fafb",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
                {item.title}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: item.color }}>
                {item.isString ? item.value : item.value.toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>
                {item.suffix}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* 模型分布表 */}
      <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13 }}>
        模型用量分布
      </div>
      <Table
        dataSource={usage?.byModel || []}
        loading={usageLoading}
        size="small"
        rowKey="model"
        pagination={false}
        columns={[
          {
            title: "模型",
            dataIndex: "model",
            key: "model",
            render: (v) => <Tag>{v}</Tag>,
          },
          {
            title: "请求次数",
            dataIndex: "requests",
            key: "requests",
            align: "right",
          },
          {
            title: "Total Tokens",
            dataIndex: "total_tokens",
            key: "total_tokens",
            align: "right",
            render: (v) => v.toLocaleString(),
          },
          {
            title: "预估费用",
            key: "cost",
            align: "right",
            render: (_, row: any) => (
              <span style={{ color: "#f59e0b" }}>
                $
                {estimateCost(
                  row.model,
                  row.total_tokens * 0.4,
                  row.total_tokens * 0.6
                ).toFixed(5)}
              </span>
            ),
          },
        ]}
        locale={{
          emptyText: (
            <Empty
              description="暂无用量数据，发起一次对话后即可统计"
              imageStyle={{ height: 40 }}
            />
          ),
        }}
      />
    </div>
  );

  const apiKeyTab = (
    <div>
      <Alert
        message={
          <span>
            使用 cowhouse API Key 可将任何支持 OpenAI 格式的工具（Cursor / Cline
            / Chatbox / Open WebUI 等）接入 cowhouse 管理的所有模型。
            <br />
            <Text code style={{ fontSize: 12 }}>
              Base URL: {window.location.origin}/v1
            </Text>
          </span>
        }
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* 新 Key 展示（一次性） */}
      {newlyCreatedKey && (
        <Alert
          message="⚠️ 请立即保存此 API Key，它只会显示一次！"
          description={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 8,
              }}
            >
              <Text code copyable style={{ flex: 1, wordBreak: "break-all" }}>
                {newlyCreatedKey}
              </Text>
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(newlyCreatedKey);
                  antdMessage.success("已复制");
                }}
              />
            </div>
          }
          type="warning"
          showIcon
          closable
          onClose={() => setNewlyCreatedKey(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 创建新 Key */}
      <Space.Compact style={{ width: "100%", marginBottom: 16 }}>
        <Input
          placeholder="输入 Key 名称（如：Cursor、Cline）"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          onPressEnter={handleCreateKey}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          loading={creating}
          onClick={handleCreateKey}
          disabled={!newKeyName.trim()}
        >
          创建
        </Button>
      </Space.Compact>

      {/* Key 列表 */}
      <Table
        dataSource={apiKeys}
        loading={keysLoading}
        rowKey="id"
        size="small"
        pagination={false}
        columns={[
          {
            title: "名称",
            dataIndex: "name",
            key: "name",
            render: (v, row: any) => (
              <Space>
                {row.is_active ? (
                  <CheckCircleOutlined style={{ color: "#10b981" }} />
                ) : (
                  <CloseCircleOutlined style={{ color: "#ef4444" }} />
                )}
                <span>{v}</span>
              </Space>
            ),
          },
          {
            title: "Key 前缀",
            dataIndex: "key_prefix",
            key: "key_prefix",
            render: (v) => <Text code>{v}...</Text>,
          },
          {
            title: "状态",
            dataIndex: "is_active",
            key: "is_active",
            render: (v) =>
              v ? <Tag color="green">有效</Tag> : <Tag color="red">已吊销</Tag>,
          },
          {
            title: "最后使用",
            dataIndex: "last_used_at",
            key: "last_used_at",
            render: (v) =>
              v ? new Date(v).toLocaleString("zh-CN") : "从未使用",
          },
          {
            title: "操作",
            key: "actions",
            render: (_, row: any) => (
              <Space size={4}>
                {row.is_active && (
                  <Popconfirm
                    title="确认吊销此 Key？"
                    onConfirm={() => handleRevokeKey(row.id)}
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<StopOutlined />}
                      danger
                    >
                      吊销
                    </Button>
                  </Popconfirm>
                )}
                <Popconfirm
                  title="确认删除此 Key？删除后无法恢复"
                  onConfirm={() => handleDeleteKey(row.id)}
                >
                  <Button
                    type="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    danger
                  >
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
        locale={{
          emptyText: (
            <Empty description="暂无 API Key" imageStyle={{ height: 40 }} />
          ),
        }}
      />
    </div>
  );

  const adminTab = (
    <div>
      <div style={{ marginBottom: 16, fontWeight: 600 }}>用户管理</div>
      <Table
        dataSource={users}
        loading={usersLoading}
        rowKey="uid"
        size="small"
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "用户名", dataIndex: "username", key: "username" },
          {
            title: "角色",
            dataIndex: "role",
            key: "role",
            render: (role, row) => (
              <Select
                value={role}
                size="small"
                style={{ width: 90 }}
                onChange={(newRole) => handleUpdateRole(row.uid, newRole)}
                disabled={(currentUser as any)?.uid === row.uid}
              >
                <Select.Option value="admin">Admin</Select.Option>
                <Select.Option value="user">User</Select.Option>
              </Select>
            ),
          },
          {
            title: "注册时间",
            dataIndex: "created_at",
            key: "created_at",
            render: (v) => new Date(v).toLocaleString("zh-CN"),
          },
          {
            title: "操作",
            key: "actions",
            render: (_, row) => (
              <Popconfirm
                title="确定删除该用户及其所有数据吗？此操作不可逆！"
                onConfirm={() => handleDeleteUser(row.uid)}
                disabled={(currentUser as any)?.uid === row.uid}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  disabled={(currentUser as any)?.uid === row.uid}
                >
                  删除
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </div>
  );

  const webhookTab = (
    <div>
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontWeight: 600 }}>Webhook 通知</span>
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => setShowAddWebhook(true)}
        >
          添加 Hub
        </Button>
      </div>

      <Table
        dataSource={webhooks}
        loading={webhooksLoading}
        rowKey="id"
        size="small"
        pagination={false}
        columns={[
          { title: "名称", dataIndex: "name", key: "name" },
          {
            title: "URL",
            dataIndex: "url",
            key: "url",
            render: (v) => (
              <Text ellipsis style={{ maxWidth: 200 }} copyable={{ text: v }}>
                {v}
              </Text>
            ),
          },
          {
            title: "事件",
            dataIndex: "events",
            key: "events",
            render: (evs: string[]) =>
              evs.map((ev) => (
                <Tag key={ev} color="blue" style={{ fontSize: 10 }}>
                  {ev}
                </Tag>
              )),
          },
          {
            title: "状态",
            dataIndex: "is_active",
            key: "is_active",
            render: (v, row) => (
              <Button
                size="small"
                type={v ? "primary" : "default"}
                onClick={() => handleToggleWebhook(row.id, !!v)}
              >
                {v ? "已启用" : "已禁用"}
              </Button>
            ),
          },
          {
            title: "操作",
            key: "actions",
            render: (_, row) => (
              <Popconfirm
                title="确定删除？"
                onConfirm={() => handleDeleteWebhook(row.id)}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                />
              </Popconfirm>
            ),
          },
        ]}
        locale={{
          emptyText: (
            <Empty
              description="暂无 Webhooks，点击添加来接收事件通知"
              imageStyle={{ height: 40 }}
            />
          ),
        }}
      />

      <Modal
        title="添加 Webhook"
        open={showAddWebhook}
        onCancel={() => setShowAddWebhook(false)}
        onOk={() => wbForm.submit()}
        destroyOnClose
      >
        <Form form={wbForm} layout="vertical" onFinish={handleAddWebhook}>
          <Form.Item name="name" label="昵称" rules={[{ required: true }]}>
            <Input placeholder="例如：飞书群机器人" />
          </Form.Item>
          <Form.Item
            name="url"
            label="Webhook URL"
            rules={[{ required: true, type: "url" }]}
          >
            <Input placeholder="https://..." prefix={<LinkOutlined />} />
          </Form.Item>
          <Form.Item
            name="events"
            label="监听事件"
            initialValue={["user.registration"]}
          >
            <Select mode="multiple">
              <Select.Option value="user.registration">
                用户注册 (Admin)
              </Select.Option>
              <Select.Option value="chat.usage_threshold">
                用量预警 (待开发)
              </Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="secret" label="签名密钥 (可选)">
            <Input.Password placeholder="用于 X-CW-Secret 请求头" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );

  return (
    <Modal
      title={
        <Space>
          <BarChartOutlined />
          <span>个人中心 & 平台能力</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={850}
      styles={{ body: { maxHeight: "75vh", overflowY: "auto" } }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "usage",
            label: (
              <span>
                <BarChartOutlined /> 用量统计
              </span>
            ),
            children: usageTab,
          },
          {
            key: "apikeys",
            label: (
              <span>
                <KeyOutlined /> API Keys
              </span>
            ),
            children: apiKeyTab,
          },
          {
            key: "webhooks",
            label: (
              <span>
                <NotificationOutlined /> Webhooks
              </span>
            ),
            children: webhookTab,
          },
          ...(isAdmin
            ? [
                {
                  key: "admin",
                  label: (
                    <span>
                      <TeamOutlined /> 用户管理
                    </span>
                  ),
                  children: adminTab,
                },
              ]
            : []),
        ]}
      />
    </Modal>
  );
};
