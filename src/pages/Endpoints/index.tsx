import { Sidebar } from "@/components/Sidebar";
import { useShellPreferences } from "@/hooks/useShellPreferences";
import {
  addModelToEndpoint,
  batchUpdateEndpointModels,
  createEndpoint,
  deleteEndpoint,
  deleteModelFromEndpoint,
  getAvailableModels,
  getEndpointModels,
  getEndpoints,
  getGlobalModelPolicy,
  syncEndpointModels,
  updateEndpoint,
  updateEndpointModel,
  updateGlobalModelPolicy,
} from "@/services/api";
import {
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  ModalForm,
  ProFormDigit,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProList,
} from "@ant-design/pro-components";
import {
  Button,
  Card,
  Checkbox,
  ConfigProvider,
  Drawer,
  Popconfirm,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
  theme as antdTheme,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import "../Dashboard/index.css";

const buildGenerationConfig = (values: Record<string, any>) => {
  const config = {
    temperature: values.temperature,
    top_p: values.top_p,
    max_tokens: values.max_tokens,
    presence_penalty: values.presence_penalty,
    frequency_penalty: values.frequency_penalty,
    context_window: values.context_window,
  };

  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined)
  );
};

const modelEditorInitialValues = (model?: Partial<API.Model> | null) => ({
  model_id: model?.model_id || "",
  display_name: model?.display_name || "",
  is_enabled: Number(model?.is_enabled) !== 0,
  temperature: model?.generation_config?.temperature,
  top_p: model?.generation_config?.top_p,
  max_tokens: model?.generation_config?.max_tokens,
  presence_penalty: model?.generation_config?.presence_penalty,
  frequency_penalty: model?.generation_config?.frequency_penalty,
  context_window: model?.generation_config?.context_window,
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
  const [endpoints, setEndpoints] = useState<API.Endpoint[]>([]);
  const [modelsByEndpoint, setModelsByEndpoint] = useState<
    Record<number, API.Model[]>
  >({});
  const [availableModels, setAvailableModels] = useState<API.Model[]>([]);
  const [globalModelPolicy, setGlobalModelPolicy] =
    useState<API.GlobalModelPolicy>({
      primary_model: "",
      fallback_models: [],
    });
  const [editingEndpoint, setEditingEndpoint] =
    useState<Partial<API.Endpoint> | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<API.Endpoint | null>(
    null
  );
  const [editingModel, setEditingModel] = useState<Partial<API.Model> | null>(
    null
  );
  const [selectedModelIds, setSelectedModelIds] = useState<number[]>([]);

  const loadModelsForEndpoint = async (endpointId: number) => {
    const models = await getEndpointModels(endpointId);
    setModelsByEndpoint((prev) => ({
      ...prev,
      [endpointId]: models,
    }));
    return models;
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [endpointData, policyData, enabledModels] = await Promise.all([
        getEndpoints(),
        getGlobalModelPolicy(),
        getAvailableModels(),
      ]);

      setEndpoints(endpointData);
      setGlobalModelPolicy(policyData);
      setAvailableModels(enabledModels);

      const modelEntries = await Promise.all(
        endpointData.map(async (endpoint) => [
          endpoint.id,
          await getEndpointModels(endpoint.id),
        ])
      );

      setModelsByEndpoint(Object.fromEntries(modelEntries));
    } catch (error) {
      console.error(error);
      messageApi.error("获取端点数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectedEndpointModels = selectedEndpoint
    ? modelsByEndpoint[selectedEndpoint.id] || []
    : [];

  const enabledModelOptions = useMemo(
    () =>
      (Array.isArray(availableModels) ? availableModels : []).map((model) => ({
        label: model.endpoint_name
          ? `${model.display_name || model.model_id} · ${model.endpoint_name}`
          : model.display_name || model.model_id,
        value: model.model_id,
      })),
    [availableModels]
  );

  const handleDelete = async (id: number) => {
    try {
      await deleteEndpoint(id);
      messageApi.success("删除成功");
      loadData();
    } catch {
      messageApi.error("删除失败");
    }
  };

  const handleSyncModels = async (id: number) => {
    try {
      setSyncingId(id);
      const result = await syncEndpointModels(id);
      messageApi.success(`同步成功，发现 ${result.count} 个模型`);
      await loadModelsForEndpoint(id);
      setAvailableModels(await getAvailableModels());
    } catch (error: any) {
      messageApi.error(error?.message || "同步失败");
    } finally {
      setSyncingId(null);
    }
  };

  const handleToggleModel = async (model: API.Model, checked: boolean) => {
    try {
      await updateEndpointModel(Number(model.id), {
        is_enabled: checked ? 1 : 0,
      });
      if (selectedEndpoint) {
        await loadModelsForEndpoint(selectedEndpoint.id);
      }
      setAvailableModels(await getAvailableModels());
      messageApi.success(checked ? "模型已启用" : "模型已禁用");
    } catch (error: any) {
      messageApi.error(error?.message || "模型状态更新失败");
    }
  };

  const handleBatchToggleModels = async (checked: boolean) => {
    if (!selectedEndpoint || selectedModelIds.length === 0) {
      messageApi.warning("请先选择模型");
      return;
    }

    try {
      const result = await batchUpdateEndpointModels(selectedEndpoint.id, {
        model_ids: selectedModelIds,
        is_enabled: checked ? 1 : 0,
      });
      await loadModelsForEndpoint(selectedEndpoint.id);
      setAvailableModels(await getAvailableModels());
      messageApi.success(
        `${checked ? "批量启用" : "批量禁用"}成功，更新 ${result.updated} 个模型`
      );
    } catch (error: any) {
      messageApi.error(error?.message || "批量更新失败");
    }
  };

  useEffect(() => {
    if (!selectedEndpoint) {
      setSelectedModelIds([]);
      return;
    }

    const currentIds = (modelsByEndpoint[selectedEndpoint.id] || [])
      .map((model) => Number(model.id))
      .filter((id) => Number.isInteger(id) && id > 0);

    setSelectedModelIds((prev) => prev.filter((id) => currentIds.includes(id)));
  }, [modelsByEndpoint, selectedEndpoint]);

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
          activePath="/endpoints"
        />

        <main className="cw-dashboard-main-wrap">
          <section className="cw-dashboard-hero">
            <div className="cw-hero-content">
              <div className="cw-dashboard-eyebrow">
                <span className="cw-pulse"></span>
                LLM Connectivity
              </div>
              <h1>LLM 端点</h1>
              <p>
                管理并接入多样的模型后端。配置主从模型策略，确保 Agent 随时都能调用最合适的 LLM 能力。
                端点负责连接；模型负责逻辑与参数。
              </p>
            </div>
            <div className="cw-user-card" style={{ padding: '24px 32px' }}>
              <div className="cw-user-avatar-wrap">
                <div style={{ 
                  width: 48, 
                  height: 48, 
                  background: 'linear-gradient(135deg, #2563eb, #06b6d4)', 
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
                <div className="cw-user-name" style={{ fontSize: 18 }}>{endpoints.length} 个端点</div>
                <div className="cw-user-desc">连接正常</div>
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
                  <ApiOutlined style={{ fontSize: 20, color: "#3b82f6" }} />
                  <h3 style={{ margin: 0 }}>全局模型策略</h3>
                </Space>
                <Typography.Text type="secondary">
                  任务编排和其他默认场景都会优先使用这里设置的主模型与备用模型。
                </Typography.Text>
              </div>

              <ModalForm<API.GlobalModelPolicy>
                trigger={<Button type="primary">编辑全局模型策略</Button>}
                title="全局模型策略"
                initialValues={globalModelPolicy}
                modalProps={{ destroyOnHidden: true }}
                onFinish={async (values) => {
                  try {
                    const saved = await updateGlobalModelPolicy({
                      primary_model: String(values.primary_model || ""),
                      fallback_models: Array.isArray(values.fallback_models)
                        ? values.fallback_models
                        : [],
                    });
                    setGlobalModelPolicy(saved);
                    messageApi.success("已保存");
                    return true;
                  } catch (error: any) {
                    messageApi.error(error?.message || "保存失败");
                    return false;
                  }
                }}
              >
                <ProFormSelect
                  name="primary_model"
                  label="全局主模型"
                  options={enabledModelOptions}
                  placeholder="选择默认主模型"
                />
                <ProFormSelect
                  name="fallback_models"
                  label="全局备用模型列表"
                  mode="multiple"
                  options={enabledModelOptions}
                  placeholder="主模型不可用时按顺序尝试"
                />
              </ModalForm>

              <div style={{ marginTop: 16 }}>
                <Space wrap>
                  <Tag color="gold">
                    主模型：{globalModelPolicy.primary_model || "未设置"}
                  </Tag>
                  {globalModelPolicy.fallback_models.length > 0 ? (
                    globalModelPolicy.fallback_models.map((modelId) => (
                      <Tag key={modelId} color="blue">
                        备用：{modelId}
                      </Tag>
                    ))
                  ) : (
                    <Tag>无备用模型</Tag>
                  )}
                </Space>
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
                  <ApiOutlined style={{ fontSize: 20, color: "#3b82f6" }} />
                  <h3 style={{ margin: 0 }}>接入点列表</h3>
                </Space>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setEditingEndpoint({
                      provider: "openai_compatible",
                      use_preset_models: true,
                    })
                  }
                >
                  添加端点
                </Button>
              </div>

              <ProList<API.Endpoint>
                rowKey="id"
                dataSource={endpoints}
                loading={loading}
                metas={{
                  title: {
                    dataIndex: "name",
                    render: (text, row) => (
                      <Space wrap>
                        <b>{text}</b>
                        <Tag color="cyan">{row.provider}</Tag>
                      </Space>
                    ),
                  },
                  description: {
                    render: (_, row) => {
                      const models = modelsByEndpoint[row.id] || [];
                      const enabledCount = models.filter(
                        (model) => Number(model.is_enabled) === 1
                      ).length;
                      return (
                        <Space direction="vertical" style={{ width: "100%" }}>
                          <Typography.Text type="secondary">
                            {row.base_url}
                          </Typography.Text>
                          <Space wrap>
                            <Tag>{models.length} 个模型</Tag>
                            <Tag color={enabledCount > 0 ? "green" : "default"}>
                              已启用 {enabledCount}
                            </Tag>
                          </Space>
                        </Space>
                      );
                    },
                  },
                  actions: {
                    render: (_, row) => (
                      <div className="cw-row-icon-actions">
                        <Tooltip title="同步模型">
                          <Button 
                            type="text" 
                            size="small" 
                            icon={<SyncOutlined spin={syncingId === row.id} />} 
                            onClick={() => handleSyncModels(row.id)} 
                          />
                        </Tooltip>
                        <Tooltip title="管理模型">
                          <Button
                            type="text"
                            size="small"
                            icon={<ApiOutlined />}
                            onClick={async () => {
                              setSelectedEndpoint(row);
                              setSelectedModelIds([]);
                              await loadModelsForEndpoint(row.id);
                            }}
                          />
                        </Tooltip>
                        <Tooltip title="编辑">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => setEditingEndpoint(row)}
                          />
                        </Tooltip>
                        <Tooltip title="删除">
                          <Popconfirm
                            title="确定删除此端点吗？"
                            onConfirm={() => handleDelete(row.id)}
                            okText="确定"
                            cancelText="取消"
                          >
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                            />
                          </Popconfirm>
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
          title={editingEndpoint?.id ? "编辑端点" : "添加端点"}
          open={!!editingEndpoint}
          onOpenChange={(visible) => !visible && setEditingEndpoint(null)}
          initialValues={editingEndpoint || {}}
          onFinish={async (values) => {
            try {
              if (editingEndpoint?.id) {
                await updateEndpoint(editingEndpoint.id, values);
              } else {
                await createEndpoint(values);
              }
              messageApi.success("保存成功");
              loadData();
              return true;
            } catch (error: any) {
              messageApi.error(error?.message || "保存失败");
              return false;
            }
          }}
        >
          <ProFormText
            name="name"
            label="端点名称"
            placeholder="如: OpenAI Official"
            rules={[{ required: true }]}
          />
          <ProFormSelect
            name="provider"
            label="服务商类型"
            options={[
              { label: "OpenAI Compatible", value: "openai_compatible" },
              { label: "OpenAI", value: "openai" },
              { label: "Gemini", value: "gemini" },
              { label: "OpenRouter", value: "openrouter" },
            ]}
            rules={[{ required: true }]}
          />
          <ProFormText
            name="base_url"
            label="Base URL"
            placeholder="https://api.openai.com/v1"
            rules={[{ required: true }]}
          />
          <ProFormText.Password name="api_key" label="API Key" placeholder="sk-..." />
          <ProFormSwitch
            name="use_preset_models"
            label="启用预设模型列表"
            tooltip="标准服务商可开启，方便首轮配置"
          />
        </ModalForm>

        <Drawer
          title={
            selectedEndpoint ? `模型管理 · ${selectedEndpoint.name}` : "模型管理"
          }
          width={780}
          open={!!selectedEndpoint}
          onClose={() => {
            setSelectedEndpoint(null);
            setEditingModel(null);
            setSelectedModelIds([]);
          }}
        >
          {selectedEndpoint ? (
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <Space style={{ justifyContent: "space-between", width: "100%" }}>
                <Typography.Text type="secondary">
                  你可以手动录入模型名，并分别调整启用状态与高级参数。支持批量启用和批量禁用。
                </Typography.Text>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setEditingModel({
                      is_enabled: 1,
                    })
                  }
                >
                  手动添加模型
                </Button>
              </Space>

              <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                <Space wrap>
                  <Button
                    size="small"
                    onClick={() =>
                      setSelectedModelIds(
                        selectedEndpointModels
                          .map((model) => Number(model.id))
                          .filter((id) => Number.isInteger(id) && id > 0)
                      )
                    }
                  >
                    全选
                  </Button>
                  <Button size="small" onClick={() => setSelectedModelIds([])}>
                    清空选择
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    disabled={selectedModelIds.length === 0}
                    onClick={() => handleBatchToggleModels(true)}
                  >
                    批量启用
                  </Button>
                  <Button
                    size="small"
                    danger
                    ghost
                    disabled={selectedModelIds.length === 0}
                    onClick={() => handleBatchToggleModels(false)}
                  >
                    批量禁用
                  </Button>
                </Space>
                <Typography.Text type="secondary">
                  已选择 {selectedModelIds.length} 个模型
                </Typography.Text>
              </Space>

              <ProList<API.Model>
                rowKey="id"
                dataSource={selectedEndpointModels}
                metas={{
                  title: {
                    render: (_, row) => (
                      <Space wrap>
                        <Checkbox
                          checked={selectedModelIds.includes(Number(row.id))}
                          onChange={(e) => {
                            const rowId = Number(row.id);
                            if (!Number.isInteger(rowId) || rowId <= 0) {
                              return;
                            }
                            setSelectedModelIds((prev) =>
                              e.target.checked
                                ? Array.from(new Set([...prev, rowId]))
                                : prev.filter((id) => id !== rowId)
                            );
                          }}
                          onClick={(event) => event.stopPropagation()}
                        />
                        <b>{row.display_name || row.model_id}</b>
                        <Tag>{row.model_id}</Tag>
                        <Tag color={Number(row.is_enabled) === 1 ? "success" : "default"}>
                          {Number(row.is_enabled) === 1 ? "已启用" : "已禁用"}
                        </Tag>
                        <Tag color={row.source === "manual" ? "gold" : "blue"}>
                          {row.source === "manual" ? "手动" : "同步"}
                        </Tag>
                      </Space>
                    ),
                  },
                  description: {
                    render: (_, row) => (
                      <Space wrap>
                        {Object.entries(row.generation_config || {}).length > 0 ? (
                          Object.entries(row.generation_config || {}).map(
                            ([key, value]) => (
                              <Tag key={key} color="purple">
                                {key}: {String(value)}
                              </Tag>
                            )
                          )
                        ) : (
                          <Typography.Text type="secondary">
                            未配置模型默认高级参数
                          </Typography.Text>
                        )}
                      </Space>
                    ),
                  },
                  actions: {
                    render: (_, row) => (
                      <div className="cw-row-icon-actions">
                        <Tooltip title={Number(row.is_enabled) === 1 ? "禁用" : "启用"}>
                          <Button
                            type="text"
                            size="small"
                            icon={Number(row.is_enabled) === 1 ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                            onClick={() => handleToggleModel(row, Number(row.is_enabled) !== 1)}
                          />
                        </Tooltip>
                        <Tooltip title="编辑">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => setEditingModel(row)}
                          />
                        </Tooltip>
                        <Tooltip title="删除">
                          <Popconfirm
                            title="确定删除这个模型吗？"
                            onConfirm={async () => {
                              await deleteModelFromEndpoint(Number(row.id));
                              if (selectedEndpoint) await loadModelsForEndpoint(selectedEndpoint.id);
                              setAvailableModels(await getAvailableModels());
                              messageApi.success("已删除");
                            }}
                          >
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                            />
                          </Popconfirm>
                        </Tooltip>
                      </div>
                    ),
                  },
                }}
              />
            </Space>
          ) : null}
        </Drawer>

        <ModalForm
          title={editingModel?.id ? "编辑模型" : "手动添加模型"}
          open={!!editingModel}
          onOpenChange={(visible) => !visible && setEditingModel(null)}
          initialValues={modelEditorInitialValues(editingModel)}
          modalProps={{ destroyOnHidden: true }}
          onFinish={async (values) => {
            if (!selectedEndpoint) {
              return false;
            }

            const payload = {
              model_id: String(values.model_id || "").trim(),
              display_name: String(values.display_name || values.model_id || "").trim(),
              is_enabled: values.is_enabled ? 1 : 0,
              generation_config: buildGenerationConfig(values),
            };

            try {
              if (editingModel?.id) {
                await updateEndpointModel(Number(editingModel.id), payload);
              } else {
                await addModelToEndpoint(selectedEndpoint.id, payload as API.Model);
              }
              await loadModelsForEndpoint(selectedEndpoint.id);
              setAvailableModels(await getAvailableModels());
              messageApi.success("保存成功");
              setEditingModel(null);
              return true;
            } catch (error: any) {
              messageApi.error(error?.message || "保存失败");
              return false;
            }
          }}
        >
          <ProFormText
            name="model_id"
            label="模型名"
            placeholder="如：gpt-4o-mini / claude-3-7-sonnet / gemini-2.0-flash"
            rules={[{ required: true }]}
          />
          <ProFormText
            name="display_name"
            label="显示名称"
            placeholder="可选，不填则跟模型名相同"
          />
          <ProFormSwitch name="is_enabled" label="启用此模型" initialValue />
          <ProFormDigit name="temperature" label="默认 Temperature" min={0} max={2} fieldProps={{ precision: 2 }} />
          <ProFormDigit name="top_p" label="默认 Top P" min={0} max={1} fieldProps={{ precision: 2 }} />
          <ProFormDigit name="max_tokens" label="默认 Max Tokens" min={1} fieldProps={{ precision: 0 }} />
          <ProFormDigit
            name="context_window"
            label="默认上下文窗口"
            min={1024}
            fieldProps={{ precision: 0 }}
            extra="仅作为新对话/任务会话的默认值；对话页可按会话单独设置。"
          />
          <ProFormDigit
            name="presence_penalty"
            label="默认 Presence Penalty"
            min={-2}
            max={2}
            fieldProps={{ precision: 2 }}
          />
          <ProFormDigit
            name="frequency_penalty"
            label="默认 Frequency Penalty"
            min={-2}
            max={2}
            fieldProps={{ precision: 2 }}
          />
        </ModalForm>
      </div>
    </ConfigProvider>
  );
};
