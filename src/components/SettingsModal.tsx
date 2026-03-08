import {
  addModelToEndpoint,
  clearAllHistory,
  createEndpoint,
  deleteEndpoint,
  deleteModelFromEndpoint,
  getEndpointModels,
  getEndpoints,
  setDefaultEndpoint,
  syncEndpointModels,
  updateEndpoint,
} from "@/services/api";
import {
  DeleteOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  ModalForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProList,
} from "@ant-design/pro-components";
import { Button, Form, message, Modal, Popconfirm, Space, Tag } from "antd";
import { useEffect, useState } from "react";


export const SettingsModal = ({
  open,
  onOpenChange,
  onHistoryCleared,
  onModelsChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHistoryCleared?: () => void;
  onModelsChanged?: () => void;
}) => {
  const providerOptions = [
    { label: "OpenAI Compatible", value: "openai_compatible" },
    { label: "OpenAI", value: "openai" },
    { label: "Gemini", value: "gemini" },
    { label: "OpenRouter", value: "openrouter" },
  ];

  const providerBaseUrl: Record<string, string> = {
    openai_compatible: "",
    openai: "https://api.openai.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    openrouter: "https://openrouter.ai/api/v1",
  };

  const [endpoints, setEndpoints] = useState<API.Endpoint[]>([]);
  const [editingEndpoint, setEditingEndpoint] = useState<API.Endpoint | null>(
    null
  );
  const [selectedEndpointForModels, setSelectedEndpointForModels] =
    useState<API.Endpoint | null>(null);


  // Model management state
  const [models, setModels] = useState<API.Model[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [newModelForm] = Form.useForm();

  const loadEndpoints = async () => {
    try {
      const data = await getEndpoints();
      setEndpoints(data);
    } catch (error) {
      console.error(error);
    }
  };

  const loadModels = async (endpointId: number) => {
    try {
      setLoadingModels(true);
      const data = await getEndpointModels(endpointId);
      setModels(data);
    } catch (error) {
      setModels([]);
      message.error("加载模型列表失败");
      console.error(error);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleSyncModels = async () => {
    if (!selectedEndpointForModels) return;
    try {
      setLoadingModels(true);
      const result = await syncEndpointModels(selectedEndpointForModels.id);
      setModels(result.models || []);
      message.success(`已同步 ${result.count || 0} 个模型`);
      onModelsChanged?.();
    } catch (error: any) {
      const msg =
        error?.response?.data?.error ||
        error?.data?.error ||
        error?.message ||
        "同步模型列表失败";
      message.error(msg);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadEndpoints();
    }
  }, [open]);

  useEffect(() => {
    if (selectedEndpointForModels) {
      loadModels(selectedEndpointForModels.id);
    }
  }, [selectedEndpointForModels]);

  const handleDeleteEndpoint = async (id: number) => {
    try {
      await deleteEndpoint(id);
      message.success("删除成功");
      loadEndpoints();
      onModelsChanged?.();
    } catch (error) {
      message.error("删除失败");
    }
  };

  const handleSetDefault = async (id: number) => {
    try {
      await setDefaultEndpoint(id);
      message.success("设置成功");
      loadEndpoints();
      onModelsChanged?.();
    } catch (error) {
      message.error("设置失败");
    }
  };

  return (
    <ModalForm
      title="设置"
      open={open}
      onOpenChange={onOpenChange}
      submitter={false}
      width={800}
    >
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <h3>API Endpoints</h3>
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingEndpoint({} as API.Endpoint);
            }}
          >
            添加 Endpoint
          </Button>
        </Space>
      </div>

      <ProList<API.Endpoint>
        rowKey="id"
        dataSource={endpoints}
        metas={{
          title: {
            dataIndex: "name",
            render: (text, row) => (
              <Space>
                {text}
                <Tag>{row.provider || "openai_compatible"}</Tag>
                {row.is_default && <Tag color="green">默认</Tag>}
              </Space>
            ),
          },
          description: {
            dataIndex: "base_url",
          },
          actions: {
            render: (text, row) => [
              <a key="default" onClick={() => handleSetDefault(row.id)}>
                设为默认
              </a>,
              <a key="edit" onClick={() => setEditingEndpoint(row)}>
                编辑
              </a>,
              <a key="models" onClick={() => setSelectedEndpointForModels(row)}>
                模型
              </a>,
              <a
                key="delete"
                onClick={() => handleDeleteEndpoint(row.id)}
                style={{ color: "red" }}
              >
                删除
              </a>,
            ],
          },
        }}
      />

      {/* Endpoint Edit Modal */}
      <ModalForm
        title={editingEndpoint?.id ? "编辑 Endpoint" : "添加 Endpoint"}
        open={!!editingEndpoint}
        onOpenChange={(visible) => !visible && setEditingEndpoint(null)}
        initialValues={{
          provider: "openai_compatible",
          ...(editingEndpoint || {}),
        }}
        onFinish={async (values) => {
          try {
            if (editingEndpoint?.id) {
              await updateEndpoint(editingEndpoint.id, values);
            } else {
              await createEndpoint(values);
            }
            message.success("保存成功");
            setEditingEndpoint(null);
            loadEndpoints();
            onModelsChanged?.();
            return true;
          } catch (error: any) {
            const msg =
              error?.response?.data?.error ||
              error?.data?.error ||
              error?.message ||
              "保存失败";
            message.error(msg);
            return false;
          }
        }}
      >
        <ProFormSelect
          name="provider"
          label="供应商"
          options={providerOptions}
          initialValue="openai_compatible"
          rules={[{ required: true }]}
        />
        <ProFormText
          name="name"
          label="名称"
          placeholder="如：OpenAI"
          rules={[{ required: true }]}
        />
        <ProFormText
          name="base_url"
          label="Base URL"
          placeholder={`如：${providerBaseUrl.openai}（OpenAI）`}
        />
        <ProFormText.Password
          name="api_key"
          label="API Key"
          placeholder={editingEndpoint?.id ? "留空则保持不变" : "sk-..."}
          rules={[{ required: !editingEndpoint?.id }]}
        />
        <ProFormSwitch
          name="use_preset_models"
          label="使用预设模型列表"
          initialValue={true}
        />
        {!editingEndpoint?.id && (
          <ProFormSwitch name="is_default" label="设为默认" />
        )}
      </ModalForm>

      {/* Models Management Modal */}
      <Modal
        title={`管理模型 - ${selectedEndpointForModels?.name}`}
        open={!!selectedEndpointForModels}
        onCancel={() => setSelectedEndpointForModels(null)}
        footer={null}
        width={600}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div style={{ color: "#6b7280", fontSize: 13 }}>
            {selectedEndpointForModels?.use_preset_models
              ? "当前 Endpoint 正在使用预设模型列表；同步后数据会写入数据库，但聊天页仍优先使用预设列表。"
              : "管理当前 Endpoint 的模型列表"}
          </div>
          <Button
            icon={<ReloadOutlined spin={loadingModels} />}
            onClick={handleSyncModels}
            disabled={!selectedEndpointForModels || loadingModels}
          >
            刷新列表
          </Button>
        </div>

        <Form
          form={newModelForm}
          layout="inline"
          onFinish={async (values) => {
            if (!selectedEndpointForModels) return;
            try {
              await addModelToEndpoint(selectedEndpointForModels.id, values);
              message.success("添加成功");
              newModelForm.resetFields();
              loadModels(selectedEndpointForModels.id);
              onModelsChanged?.();
            } catch (error) {
              message.error("添加失败");
            }
          }}
          style={{ marginBottom: 16 }}
        >
          <Form.Item
            name="model_id"
            rules={[{ required: true, message: "请输入模型ID" }]}
          >
            <input className="ant-input" placeholder="模型 ID (如 gpt-4)" />
          </Form.Item>
          <Form.Item
            name="display_name"
            rules={[{ required: true, message: "请输入显示名称" }]}
          >
            <input className="ant-input" placeholder="显示名称" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">
              添加
            </Button>
          </Form.Item>
        </Form>

        <ProList<API.Model>
          rowKey="id"
          dataSource={models}
          loading={loadingModels}
          metas={{
            title: { dataIndex: "display_name" },
            description: { dataIndex: "model_id" },
            actions: {
              render: (text, row) => [
                <a
                  key="delete"
                  onClick={async () => {
                    try {
                      await deleteModelFromEndpoint(row.id!);
                      message.success("删除成功");
                      if (selectedEndpointForModels)
                        loadModels(selectedEndpointForModels.id);
                      onModelsChanged?.();
                    } catch (e) {
                      message.error("删除失败");
                    }
                  }}
                  style={{ color: "red" }}
                >
                  删除
                </a>,
              ],
            },
          }}
        />
      </Modal>


      {/* 危险操作区域 */}
      <div
        style={{
          marginTop: 32,
          padding: 16,
          border: "1px solid #ff4d4f",
          borderRadius: 8,
          background: "rgba(255, 77, 79, 0.04)",
        }}
      >
        <h3 style={{ color: "#ff4d4f", marginBottom: 8 }}>危险操作</h3>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 500 }}>清空所有历史消息</div>
            <div style={{ color: "#6b7280", fontSize: 13 }}>
              删除当前账户的所有对话和消息，此操作不可恢复
            </div>
          </div>
          <Popconfirm
            title="确认清空所有历史消息？"
            description="此操作将永久删除你的所有对话和消息，无法恢复。确定要继续吗？"
            icon={<ExclamationCircleOutlined style={{ color: "red" }} />}
            okText="确认清空"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              try {
                const result = await clearAllHistory();
                if (!result?.success) {
                  throw new Error("清空失败");
                }
                setSelectedEndpointForModels(null);
                setModels([]);
                message.success(
                  `已清空 ${result.deleted_conversations || 0} 个对话，${
                    result.deleted_messages || 0
                  } 条消息`
                );
                window.dispatchEvent(new CustomEvent("cw.history.cleared"));
                onHistoryCleared?.();
                onOpenChange(false);
              } catch (error: any) {
                const msg =
                  error?.response?.data?.error ||
                  error?.data?.error ||
                  error?.message ||
                  "清空失败，请重试";
                message.error(msg);
              }
            }}
          >
            <Button danger htmlType="button" icon={<DeleteOutlined />}>
              清空所有消息
            </Button>
          </Popconfirm>
        </div>
      </div>
    </ModalForm>
  );
};
