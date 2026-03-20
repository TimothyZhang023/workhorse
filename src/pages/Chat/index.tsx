import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Sidebar } from "@/components/Sidebar";
import { useShellPreferences } from "@/hooks/useShellPreferences";
import {
  createAcpAgent,
  createChannel,
  createConversation,
  deleteConversation,
  deleteAcpAgent,
  deleteChannelAgent,
  compactConversation,
  getConversationAcpModels,
  getConversationContextBudget,
  getAcpAgents,
  getAcpAgentTemplates,
  getChannelExtensions,
  getChannels,
  getConversations,
  getMainAgentPromptSetting,
  getMessages,
  setConversationAcpModel,
  stopConversationExecution,
  summarizeConversationTitle,
  updateConversation,
  updateAcpAgent,
  updateChannelAgent,
  updateMainAgentPromptSetting,
} from "@/services/api";
import {
  AppstoreOutlined,
  BugOutlined,
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  ArrowLeftOutlined,
  DownOutlined,
  DeleteOutlined,
  EditOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
  ToolOutlined,
  UpOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";
import { useAppStore } from "@/stores/useAppStore";
import { createAuthHeaders, resolveApiUrl } from "@/services/request";
import {
  Avatar,
  Button,
  ConfigProvider,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Segmented,
  Switch,
  Tag,
  Tooltip,
  Upload,
  message as antdMessage,
  theme as antdTheme,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./index.css";

const { TextArea } = Input;

// 将图片文件转为 base64
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // 只保留 base64 数据部分
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
  });

// 从存储内容中提取显示文本（去掉图片数据）
const extractDisplayContent = (content: string): string => {
  return content.replace(/\[IMAGE_DATA:[^\]]+\]/g, "[📷 图片]");
};

// 检查消息是否包含图片
const hasImage = (content: string): boolean => content.includes("[IMAGE_DATA:");

const getToolMessageName = (message: API.Message): string => {
  if (message.name) return message.name;

  const runningMatch = String(message.content || "").match(
    /^🔧 正在执行工具：(.+?)\.\.\.$/
  );
  return runningMatch?.[1] || "工具执行";
};

const getToolMessageStatus = (
  message: API.Message
): "running" | "error" | "success" => {
  const content = String(message.content || "");
  if (content.startsWith("🔧 正在执行工具：")) {
    return "running";
  }

  if (/error|failed|失败/i.test(content)) {
    return "error";
  }

  return "success";
};

const STREAM_FLUSH_INTERVAL = 48; // 增加刷新间隔
const STREAM_SEGMENT_DRAIN_INTERVAL = 32; // 增加排放间隔
const TITLE_REFRESH_DELAYS = [1200, 2600, 5000, 9000];

type ChatDebugEvent = {
  id: string;
  timestamp?: string;
  phase?: string;
  [key: string]: any;
};

type WorkspaceAgent = {
  id: string;
  name: string;
  kind: "main" | "channel" | "acp";
  platform?: string;
  channelId?: number;
  acpAgentId?: number;
  preset?: API.AcpAgent["preset"];
  agentPrompt?: string;
  defaultModelId?: string | null;
  lastUsedModelId?: string | null;
  description: string;
  listenerState?: API.Channel["listener_state"];
};

type ChannelCreateFormValues = {
  name: string;
  platform: string;
  agent_prompt?: string;
  client_id?: string;
  client_secret?: string;
  update_mode?: "polling" | "webhook";
  webhook_url?: string;
  secret_token?: string;
  bot_token?: string;
};

type AcpAgentCreateFormValues = {
  name: string;
  preset: API.AcpAgent["preset"];
  command?: string;
  api_key?: string;
  agent_prompt?: string;
  default_model_id?: string;
};

type AgentSettingsFormValues = {
  name?: string;
  agent_prompt?: string;
  default_model_id?: string;
};

type AcpConversationModelsState = API.AcpConversationModels | null;

const safeTrim = (value: unknown): string => String(value ?? "").trim();

const MAIN_AGENT_ID = "main";
const CONVERSATION_AGENT_MAP_KEY = "cw.conversation_agent_map.v1";
const CHANNEL_AGENT_ADAPTERS: Record<
  string,
  {
    label: string;
    docs: string;
    connectionLabel: string;
    description: string;
  }
> = {
  dingding: {
    label: "DingTalk",
    docs: "https://open-dingtalk.github.io/developerpedia/docs/learn/bot/stream/bot-stream-overview/",
    connectionLabel: "Stream Mode",
    description: "通过 Stream Mode 与钉钉服务端保持长连接接收机器人事件。",
  },
  dingtalk: {
    label: "DingTalk",
    docs: "https://open-dingtalk.github.io/developerpedia/docs/learn/bot/stream/bot-stream-overview/",
    connectionLabel: "Stream Mode",
    description: "通过 Stream Mode 与钉钉服务端保持长连接接收机器人事件。",
  },
  telegram: {
    label: "Telegram",
    docs: "https://core.telegram.org/bots/api",
    connectionLabel: "Polling / Webhook",
    description: "通过 Bot API 接收更新，支持长轮询或 webhook 两种模式。",
  },
};

const getListenerStatusText = (state?: API.Channel["listener_state"] | null) => {
  if (!state) return "未启动";
  if (state.status === "stream_active") return "监听中";
  if (state.status === "polling") return "轮询中";
  if (state.status === "webhook_active") return "Webhook 已注册";
  if (state.status === "reconnecting") return "重连中";
  if (state.status === "error") return state.lastError || "监听异常";
  if (state.status === "stopped") return "已停止";
  return "启动中";
};

const splitIncomingStreamContent = (text: string): string[] => {
  const raw = String(text || "");
  if (!raw) return [];

  // 打字机模式：按字符（含中文）逐步输出，标点优先单独落字。
  const chars = Array.from(raw);
  const segments: string[] = [];
  let buffer = "";

  for (const ch of chars) {
    buffer += ch;
    if (/[。！？!?；;，,\s\n]/.test(ch) || buffer.length >= 3) {
      segments.push(buffer);
      buffer = "";
    }
  }
  if (buffer) segments.push(buffer);
  return segments;
};

const getResponseErrorMessage = async (response: Response) => {
  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      return (
        data?.error?.message ||
        data?.error ||
        data?.message ||
        `请求失败 (${response.status})`
      );
    }

    const text = await response.text();
    return text || `请求失败 (${response.status})`;
  } catch (error) {
    return `请求失败 (${response.status})`;
  }
};

const getLatestDebugIssue = (
  events: ChatDebugEvent[]
): ChatDebugEvent | null => {
  const candidates = [...events].reverse();
  return (
    candidates.find(
      (event) =>
        event?.error ||
        event?.notice ||
        event?.phase === "execution_aborted" ||
        event?.phase === "attempt_failed" ||
        event?.phase === "all_attempts_failed"
    ) || null
  );
};

const formatDebugIssueText = (event: ChatDebugEvent | null): string => {
  if (!event) return "";

  const primary =
    event.error ||
    event.notice ||
    (event.phase === "execution_aborted" && "执行已中断") ||
    "";
  const details = [
    event.abort_reason ? `abort_reason=${event.abort_reason}` : "",
    event.upstream_error ? `upstream_error=${event.upstream_error}` : "",
    event.phase ? `phase=${event.phase}` : "",
  ].filter(Boolean);

  return [primary, details.join(" | ")].filter(Boolean).join("\n");
};

const readConversationAgentMap = (): Record<string, string> => {
  try {
    const raw = window.localStorage.getItem(CONVERSATION_AGENT_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
};

const resolveConversationAgentId = (
  conversation: Pick<API.Conversation, "id" | "channel_id" | "acp_agent_id">,
  conversationAgentMap: Record<string, string>
) => {
  if (conversation.acp_agent_id) {
    return `acp:${conversation.acp_agent_id}`;
  }
  if (conversation.channel_id) {
    return `channel:${conversation.channel_id}`;
  }
  return conversationAgentMap[String(conversation.id)] || MAIN_AGENT_ID;
};

export default () => {
  const { currentUser, isLoggedIn } = useAppStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedConversationId = searchParams.get("conversationId");
  const requestedAgentId = searchParams.get("agent");
  const [channelAgentForm] = Form.useForm<ChannelCreateFormValues>();
  const [acpAgentForm] = Form.useForm<AcpAgentCreateFormValues>();
  const [agentSettingsForm] = Form.useForm<AgentSettingsFormValues>();
  const [messageApi, messageContextHolder] = antdMessage.useMessage();
  const {
    moduleExpanded,
    setModuleExpanded,
    themeMode,
    resolvedTheme,
    setThemeMode,
    isDark,
  } = useShellPreferences();

  // UI 状态
  const [moduleDrawerVisible, setModuleDrawerVisible] = useState(false);
  const [conversationDrawerVisible, setConversationDrawerVisible] =
    useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [channelAgentModalVisible, setChannelAgentModalVisible] =
    useState(false);
  const [acpAgentModalVisible, setAcpAgentModalVisible] = useState(false);
  const [creatingChannelAgent, setCreatingChannelAgent] = useState(false);
  const [creatingAcpAgent, setCreatingAcpAgent] = useState(false);
  const [agentSettingsVisible, setAgentSettingsVisible] = useState(false);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const [savingAgentSettings, setSavingAgentSettings] = useState(false);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState(MAIN_AGENT_ID);
  const [channels, setChannels] = useState<API.Channel[]>([]);
  const [channelExtensions, setChannelExtensions] = useState<
    API.ChannelExtension[]
  >([]);
  const [acpAgents, setAcpAgents] = useState<API.AcpAgent[]>([]);
  const [acpAgentTemplates, setAcpAgentTemplates] = useState<
    API.AcpAgentTemplate[]
  >([]);
  const [conversationAgentMap, setConversationAgentMap] = useState<
    Record<string, string>
  >(() => readConversationAgentMap());

  // 对话状态
  const [conversations, setConversations] = useState<API.Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<API.Message[]>([]);
  const [acpConversationModels, setAcpConversationModels] =
    useState<AcpConversationModelsState>(null);
  const [acpModelsLoading, setAcpModelsLoading] = useState(false);
  const [switchingAcpModel, setSwitchingAcpModel] = useState(false);
  const [conversationBudget, setConversationBudget] =
    useState<API.ConversationContextBudget | null>(null);
  const [conversationBudgetLoading, setConversationBudgetLoading] =
    useState(false);
  const [compactingConversation, setCompactingConversation] = useState(false);
  const [contextBudgetExpanded, setContextBudgetExpanded] = useState(false);
  const [toolMessageExpanded, setToolMessageExpanded] = useState<
    Record<string, boolean>
  >({});

  // 输入状态
  const [inputText, setInputText] = useState("");
  const [pendingImages, setPendingImages] = useState<
    { file: File; preview: string }[]
  >([]);

  // 流式处理状态
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 对话重命名状态
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // 消息编辑状态
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [editingMsgContent, setEditingMsgContent] = useState("");
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugDrawerVisible, setDebugDrawerVisible] = useState(false);
  const [debugEventsByConversation, setDebugEventsByConversation] = useState<
    Record<string, ChatDebugEvent[]>
  >({});

  // 会话搜索状态
  const [searchQuery, setSearchQuery] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentConvIdRef = useRef<string | null>(null);
  const shouldRefocusInputRef = useRef(false);
  const streamBufferRef = useRef("");
  const streamErrorRef = useRef<string | null>(null);
  const streamTargetIndexRef = useRef<number | null>(null);
  const streamFlushTimerRef = useRef<number | null>(null);
  const sseRemainderRef = useRef("");
  const streamSegmentQueueRef = useRef<string[]>([]);
  const streamSegmentDrainTimerRef = useRef<number | null>(null);
  const debugEventCounterRef = useRef(0);

  // 响应式监听
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    currentConvIdRef.current = currentConvId;
  }, [currentConvId]);

  const patchConversationAgentMap = useCallback(
    (updater: (prev: Record<string, string>) => Record<string, string>) => {
      setConversationAgentMap((prev) => {
        const next = updater(prev);
        window.localStorage.setItem(
          CONVERSATION_AGENT_MAP_KEY,
          JSON.stringify(next)
        );
        return next;
      });
    },
    []
  );

  const availableChannelPlatforms = useMemo(() => {
    const extensionPlatforms = (channelExtensions || [])
      .map((item) => item.platform)
      .filter(Boolean);
    const createDefaults = ["dingding", "telegram"];
    return Array.from(new Set([...createDefaults, ...extensionPlatforms])).filter(
      (platform) => Boolean(CHANNEL_AGENT_ADAPTERS[platform])
    );
  }, [channelExtensions]);

  const acpPresetMeta = useMemo(() => {
    return Object.fromEntries(
      (acpAgentTemplates || []).map((item) => [item.id, item])
    );
  }, [acpAgentTemplates]);

  const agents = useMemo<WorkspaceAgent[]>(() => {
    const main: WorkspaceAgent = {
      id: MAIN_AGENT_ID,
      name: "main",
      kind: "main",
      description: "Web 工作台主 Agent（原对话入口）",
    };
    const channelAgents = (channels || [])
      .filter(
        (channel) =>
          channel.platform &&
          CHANNEL_AGENT_ADAPTERS[channel.platform] &&
          Number(channel.is_enabled) === 1
      )
      .map<WorkspaceAgent>((channel) => ({
        id: `channel:${channel.id}`,
        kind: "channel",
        name: channel.name,
        platform: channel.platform,
        channelId: channel.id,
        agentPrompt: channel.agent_prompt,
        listenerState: channel.listener_state,
        description: `${CHANNEL_AGENT_ADAPTERS[channel.platform!]?.label || channel.platform} 渠道机器人`,
      }));
    const externalAcpAgents = (acpAgents || [])
      .filter((agent) => Number(agent.is_enabled) === 1)
      .map<WorkspaceAgent>((agent) => ({
        id: `acp:${agent.id}`,
        kind: "acp",
        name: agent.name,
        acpAgentId: agent.id,
        preset: agent.preset,
        agentPrompt: agent.agent_prompt,
        defaultModelId: agent.default_model_id || null,
        lastUsedModelId: agent.last_used_model_id || null,
        description:
          acpPresetMeta[agent.preset]?.description || "外部 ACP Agent",
      }));
    return [main, ...channelAgents, ...externalAcpAgents];
  }, [acpAgents, acpPresetMeta, channels]);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) || agents[0],
    [activeAgentId, agents]
  );
  const settingsAgent = useMemo(
    () => agents.find((agent) => agent.id === settingsAgentId) || null,
    [agents, settingsAgentId]
  );
  const currentConversation = useMemo(
    () =>
      currentConvId
        ? conversations.find((item) => String(item.id) === String(currentConvId)) ||
          null
        : null,
    [conversations, currentConvId]
  );
  const showAgencyOverview = !requestedAgentId && !requestedConversationId;

  const buildConversationCreateOptions = useCallback(
    (agent: WorkspaceAgent | undefined) => {
      if (!agent || agent.kind === "main") {
        return undefined;
      }

      if (agent.kind === "channel") {
        return {
          channel_id: agent.channelId || null,
        };
      }

      if (agent.kind === "acp") {
        return {
          acp_agent_id: agent.acpAgentId || null,
          acp_model_id: agent.lastUsedModelId || agent.defaultModelId || null,
        };
      }

      return undefined;
    },
    []
  );

  const pushAgencyParams = useCallback(
    (next: { agent?: string | null; conversationId?: string | null }) => {
      const params = new URLSearchParams(searchParams);
      if (next.agent === null) params.delete("agent");
      else if (next.agent !== undefined) params.set("agent", next.agent);

      if (next.conversationId === null) params.delete("conversationId");
      else if (next.conversationId !== undefined) {
        params.set("conversationId", next.conversationId);
      }

      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  // 登录检查 & 初始化
  useEffect(() => {
    if (!isLoggedIn) return;
    loadInitData();
  }, [isLoggedIn]);

  useEffect(() => {
    if (
      !requestedConversationId ||
      currentConvId === requestedConversationId ||
      !conversations.some((conv) => String(conv.id) === requestedConversationId)
    ) {
      return;
    }

    handleSelectConversation(requestedConversationId);
  }, [requestedConversationId, conversations, currentConvId]);

  useEffect(() => {
    if (!requestedAgentId) return;
    if (agents.some((agent) => agent.id === requestedAgentId)) {
      setActiveAgentId(requestedAgentId);
      return;
    }
    if (!activeAgent) {
      setActiveAgentId(MAIN_AGENT_ID);
    }
  }, [activeAgent, agents, requestedAgentId]);

  useEffect(() => {
    const handleHistoryCleared = () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      if (streamFlushTimerRef.current !== null) {
        window.clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
      if (streamSegmentDrainTimerRef.current !== null) {
        window.clearTimeout(streamSegmentDrainTimerRef.current);
        streamSegmentDrainTimerRef.current = null;
      }
      streamBufferRef.current = "";
      streamErrorRef.current = null;
      streamTargetIndexRef.current = null;
      streamSegmentQueueRef.current = [];
      sseRemainderRef.current = "";
      setLoading(false);
      setInputText("");
      setPendingImages((prev) => {
        prev.forEach((item) => URL.revokeObjectURL(item.preview));
        return [];
      });
      setConversations([]);
      setCurrentConvId(null);
      setMessages([]);
      setChannels([]);
      setChannelExtensions([]);
      setActiveAgentId(MAIN_AGENT_ID);
      setToolMessageExpanded({});
      setSearchQuery("");
      setDebugEventsByConversation({});
    };
    window.addEventListener("cw.history.cleared", handleHistoryCleared);
    return () =>
      window.removeEventListener("cw.history.cleared", handleHistoryCleared);
  }, []);

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        handleCreateChat();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [conversations]);



  const loadInitData = async () => {
    try {
      const [convs, channelList, extensions, acpList, acpTemplates] =
        await Promise.all([
        getConversations(),
        getChannels().catch(() => []),
        getChannelExtensions().catch(() => []),
        getAcpAgents().catch(() => []),
        getAcpAgentTemplates().catch(() => []),
        ]);
      setConversations(convs);
      setChannels(channelList);
      setChannelExtensions(extensions);
      setAcpAgents(acpList);
      setAcpAgentTemplates(acpTemplates);
      if (convs.length > 0) {
        const initialConversationId =
          requestedConversationId &&
            convs.some((conv) => String(conv.id) === requestedConversationId)
            ? requestedConversationId
            : convs[0].id;
        handleSelectConversation(initialConversationId);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const refreshConversations = async () => {
    try {
      const convs = await getConversations();
      setConversations(convs);
    } catch (error) {
      console.error(error);
    }
  };

  const refreshChannels = async () => {
    try {
      const channelList = await getChannels();
      setChannels(channelList);
    } catch (error) {
      console.error(error);
    }
  };

  const refreshAcpAgents = async () => {
    try {
      const items = await getAcpAgents();
      setAcpAgents(items);
    } catch (error) {
      console.error(error);
    }
  };

  const refreshConversationBudget = useCallback(
    async (conversationId: string) => {
      setConversationBudgetLoading(true);
      try {
        const budget = await getConversationContextBudget(conversationId);
        if (currentConvIdRef.current === conversationId) {
          setConversationBudget(budget);
        }
      } catch (error) {
        console.error(error);
        if (currentConvIdRef.current === conversationId) {
          setConversationBudget(null);
        }
      } finally {
        if (currentConvIdRef.current === conversationId) {
          setConversationBudgetLoading(false);
        }
      }
    },
    []
  );

  const loadAcpConversationModels = useCallback(
    async (conversationId: string) => {
      setAcpModelsLoading(true);
      try {
        const result = await getConversationAcpModels(conversationId);
        setAcpConversationModels(result);
      } catch (error) {
        console.error(error);
        setAcpConversationModels(null);
      } finally {
        setAcpModelsLoading(false);
      }
    },
    []
  );

  const openAgentSettings = useCallback(
    async (agent: WorkspaceAgent | undefined) => {
      if (!agent) return;
      setSettingsAgentId(agent.id);

      if (agent.kind === "main") {
        try {
          const result = await getMainAgentPromptSetting();
          agentSettingsForm.setFieldsValue({
            name: agent.name,
            agent_prompt: result.markdown || "",
          });
        } catch (error) {
          console.error(error);
          messageApi.error("读取 main Agent 提示词失败");
          return;
        }
      } else if (agent.kind === "channel") {
        const channel = channels.find((item) => item.id === agent.channelId);
        agentSettingsForm.setFieldsValue({
          name: channel?.name || agent.name,
          agent_prompt: channel?.agent_prompt || "",
        });
      } else if (agent.kind === "acp") {
        const acpAgent = acpAgents.find((item) => item.id === agent.acpAgentId);
        agentSettingsForm.setFieldsValue({
          name: acpAgent?.name || agent.name,
          agent_prompt: acpAgent?.agent_prompt || "",
          default_model_id: acpAgent?.default_model_id || "",
        });
      }

      setAgentSettingsVisible(true);
    },
    [acpAgents, agentSettingsForm, channels, messageApi]
  );

  const handleSaveAgentSettings = useCallback(async () => {
    if (!settingsAgent) return;

    try {
      const validatedValues = await agentSettingsForm.validateFields();
      const values = {
        ...agentSettingsForm.getFieldsValue(true),
        ...validatedValues,
      } as AgentSettingsFormValues;
      setSavingAgentSettings(true);

      if (settingsAgent.kind === "main") {
        await updateMainAgentPromptSetting(safeTrim(values.agent_prompt));
      } else if (settingsAgent.kind === "channel" && settingsAgent.channelId) {
        await updateChannelAgent(settingsAgent.channelId, {
          name: safeTrim(values.name) || settingsAgent.name,
          agent_prompt: safeTrim(values.agent_prompt),
        });
        await refreshChannels();
      } else if (settingsAgent.kind === "acp" && settingsAgent.acpAgentId) {
        await updateAcpAgent(settingsAgent.acpAgentId, {
          name: safeTrim(values.name) || settingsAgent.name,
          agent_prompt: safeTrim(values.agent_prompt),
          default_model_id: safeTrim(values.default_model_id) || null,
        });
        await refreshAcpAgents();
      }

      setAgentSettingsVisible(false);
      setSettingsAgentId(null);
      messageApi.success("Agent 配置已保存");
    } catch (error: any) {
      if (error?.errorFields) return;
      messageApi.error(error?.message || "保存 Agent 配置失败");
    } finally {
      setSavingAgentSettings(false);
    }
  }, [
    agentSettingsForm,
    messageApi,
    refreshAcpAgents,
    refreshChannels,
    settingsAgent,
  ]);

  const handleDeleteAgent = useCallback(
    async (agent: WorkspaceAgent | undefined) => {
      if (!agent || agent.kind === "main") return;

      try {
        setDeletingAgentId(agent.id);
        if (agent.kind === "channel" && agent.channelId) {
          await deleteChannelAgent(agent.channelId);
          await refreshChannels();
        } else if (agent.kind === "acp" && agent.acpAgentId) {
          await deleteAcpAgent(agent.acpAgentId);
          await refreshAcpAgents();
        }
        await refreshConversations();

        const fallbackAgentId = MAIN_AGENT_ID;
        setActiveAgentId(fallbackAgentId);
        setCurrentConvId(null);
        setMessages([]);
        pushAgencyParams({ agent: fallbackAgentId, conversationId: null });
        messageApi.success(`${agent.name} 已删除`);
      } catch (error: any) {
        messageApi.error(error?.message || "删除 Agent 失败");
      } finally {
        setDeletingAgentId(null);
      }
    },
    [messageApi, pushAgencyParams, refreshAcpAgents, refreshChannels]
  );

  const handleManualCompact = useCallback(async () => {
    if (!currentConvId) return;

    try {
      setCompactingConversation(true);
      const result = await compactConversation(currentConvId);
      const latestMessages = await getMessages(currentConvId);
      setMessages(latestMessages);
      setConversationBudget(result.budget);
      messageApi.success(
        result.compacted
          ? `已完成上下文压缩，写入 ${result.compacted_messages || 0} 段摘要`
          : "当前上下文空间仍充足，未执行压缩"
      );
    } catch (error: any) {
      messageApi.error(error?.message || "上下文压缩失败");
    } finally {
      setCompactingConversation(false);
    }
  }, [currentConvId, messageApi]);

  const handleOpenAgent = useCallback(
    (agentId: string) => {
      setActiveAgentId(agentId);
      setCurrentConvId(null);
      setMessages([]);
      setSearchQuery("");
      pushAgencyParams({ agent: agentId, conversationId: null });
    },
    [pushAgencyParams]
  );

  const isAtBottomRef = useRef(true);
  const messagesAreaRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const el = messagesAreaRef.current;
    if (!el) return;
    const threshold = 100;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isAtBottomRef.current = isAtBottom;
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    if (!isAtBottomRef.current && !force) return;
    
    // 使用 requestAnimationFrame 确保在 DOM 更新后滚动
    requestAnimationFrame(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({
          behavior: force ? "smooth" : "auto",
          block: "end",
        });
      }
    });
  }, []);

  useEffect(() => {
    scrollToBottom(loading && messages.length > 0 && messages[messages.length - 1].role === 'user');
  }, [messages, scrollToBottom, loading]);

  useEffect(() => {
    return () => {
      if (streamFlushTimerRef.current !== null) {
        window.clearTimeout(streamFlushTimerRef.current);
      }
      if (streamSegmentDrainTimerRef.current !== null) {
        window.clearTimeout(streamSegmentDrainTimerRef.current);
      }
    };
  }, []);

  const flushPendingStreamSegmentsNow = useCallback(() => {
    if (streamSegmentDrainTimerRef.current !== null) {
      window.clearTimeout(streamSegmentDrainTimerRef.current);
      streamSegmentDrainTimerRef.current = null;
    }
    if (streamSegmentQueueRef.current.length > 0) {
      streamBufferRef.current += streamSegmentQueueRef.current.join("");
      streamSegmentQueueRef.current = [];
    }
  }, []);

  const appendDebugEvent = useCallback(
    (conversationId: string | null, event: Record<string, any>) => {
      if (!conversationId) return;

      setDebugEventsByConversation((prev) => {
        const nextEvent: ChatDebugEvent = {
          id: `${conversationId}-${debugEventCounterRef.current++}`,
          ...event,
        };
        const currentEvents = prev[conversationId] || [];
        return {
          ...prev,
          [conversationId]: [...currentEvents, nextEvent].slice(-500),
        };
      });
    },
    []
  );

  useEffect(() => {
    if (loading || !shouldRefocusInputRef.current) return;
    shouldRefocusInputRef.current = false;
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, [loading]);

  const flushStreamBuffer = useCallback(() => {
    if (streamFlushTimerRef.current !== null) {
      window.clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = null;
    }

    const targetIndex = streamTargetIndexRef.current;
    const bufferedContent = streamBufferRef.current;
    const bufferedError = streamErrorRef.current;

    if (targetIndex === null) return;
    if (!bufferedContent && !bufferedError) return;

    streamBufferRef.current = "";
    streamErrorRef.current = null;

    setMessages((prev) => {
      if (targetIndex === null || !prev[targetIndex]) return prev;

      const next = [...prev];
      const target = next[targetIndex];
      if (!target || target.role !== "assistant") return prev;

      next[targetIndex] = {
        ...target,
        content: bufferedError
          ? `❌ 错误：${bufferedError}`
          : `${target.content}${bufferedContent}`,
      };
      return next;
    });
  }, []);

  const scheduleStreamFlush = useCallback(() => {
    if (streamFlushTimerRef.current !== null) return;
    streamFlushTimerRef.current = window.setTimeout(() => {
      flushStreamBuffer();
    }, STREAM_FLUSH_INTERVAL);
  }, [flushStreamBuffer]);

  const scheduleSegmentDrain = useCallback(() => {
    if (streamSegmentDrainTimerRef.current !== null) return;

    const drain = () => {
      const queue = streamSegmentQueueRef.current;
      if (queue.length === 0) {
        streamSegmentDrainTimerRef.current = null;
        return;
      }

      // 如果积压较多，一次多消耗几个段以跟上进度
      const count = queue.length > 20 ? 5 : (queue.length > 10 ? 3 : 1);
      
      for (let i = 0; i < count; i++) {
        const piece = queue.shift();
        if (piece) {
          streamBufferRef.current += piece;
        }
      }
      
      scheduleStreamFlush();
      
      streamSegmentDrainTimerRef.current = window.setTimeout(
        drain,
        STREAM_SEGMENT_DRAIN_INTERVAL
      );
    };

    streamSegmentDrainTimerRef.current = window.setTimeout(drain, 0);
  }, [scheduleStreamFlush]);

  const appendAssistantChunk = useCallback(
    (content?: string, error?: string) => {
      if (content) {
        const segments = splitIncomingStreamContent(content);
        streamSegmentQueueRef.current.push(...segments);
        scheduleSegmentDrain();
      }
      if (error) {
        streamErrorRef.current = error;
        flushPendingStreamSegmentsNow();
        flushStreamBuffer();
        return;
      }
    },
    [
      flushPendingStreamSegmentsNow,
      flushStreamBuffer,
      scheduleSegmentDrain,
    ]
  );

  const createAssistantPlaceholder = useCallback(async () => {
    streamBufferRef.current = "";
    streamErrorRef.current = null;
    sseRemainderRef.current = "";
    flushPendingStreamSegmentsNow();

    await new Promise<void>((resolve) => {
      setMessages((prev) => {
        const nextIndex = prev.length;
        streamTargetIndexRef.current = nextIndex;
        resolve();
        return [...prev, { role: "assistant", content: "" }];
      });
    });
  }, [flushPendingStreamSegmentsNow]);

  const replaceAssistantMessage = useCallback(
    (index: number | null, content: string) => {
      if (index === null || !content) return;
      streamBufferRef.current = "";
      streamErrorRef.current = null;
      if (streamFlushTimerRef.current !== null) {
        window.clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }

      setMessages((prev) => {
        if (!prev[index]) return prev;
        const next = [...prev];
        const target = next[index];
        if (!target || target.role !== "assistant") return prev;
        next[index] = { ...target, content };
        return next;
      });
    },
    []
  );

  const processSseChunk = useCallback(
    (
      rawChunk: string,
      handlers: {
        onData: (parsed: any) => void;
      }
    ) => {
      const combined = sseRemainderRef.current + rawChunk;
      const parts = combined.split("\n");
      sseRemainderRef.current = parts.pop() ?? "";

      for (const part of parts) {
        if (!part.startsWith("data: ")) continue;
        const data = part.slice(6).trim();
        if (!data || data === "[DONE]") continue;
        try {
          handlers.onData(JSON.parse(data));
        } catch (e) {
          // ignore partial parse errors and malformed lines
        }
      }
    },
    []
  );

  const flushSseRemainder = useCallback(
    (handlers: { onData: (parsed: any) => void }) => {
      if (!sseRemainderRef.current.trim()) return;
      processSseChunk("\n", handlers);
    },
    [processSseChunk]
  );

  const syncConversationMessages = useCallback(async (convId: string) => {
    try {
      const latest = await getMessages(convId);
      if (currentConvIdRef.current === convId) {
        setMessages(latest);
      }
    } catch (error) {
      console.error(error);
    }
  }, []);

  const handleCreateChat = async () => {
    try {
      const newConv = await createConversation(
        "新对话",
        buildConversationCreateOptions(activeAgent)
      );
      const agentId = activeAgentId || MAIN_AGENT_ID;
      if (agentId === MAIN_AGENT_ID) {
        patchConversationAgentMap((prev) => ({
          ...prev,
          [String(newConv.id)]: agentId,
        }));
      }
      setConversations((prev) => [newConv, ...prev]);
      setCurrentConvId(newConv.id);
      setMessages([]);
      pushAgencyParams({ agent: agentId, conversationId: String(newConv.id) });
      if (isMobile) setConversationDrawerVisible(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (error) {
      console.error(error);
    }
  };

  const handleCreateChannelAgent = async () => {
    try {
      const validatedValues = await channelAgentForm.validateFields();
      const values = {
        ...channelAgentForm.getFieldsValue(true),
        ...validatedValues,
      } as ChannelCreateFormValues;
      const name = safeTrim(values.name);
      if (!name) {
        throw new Error("请输入 Agent 名称");
      }
      setCreatingChannelAgent(true);
      const normalizedPlatform =
        values.platform === "dingding" ? "dingtalk" : values.platform;
      const metadata =
        normalizedPlatform === "dingtalk"
          ? {
              connection_mode: "stream",
              docs: CHANNEL_AGENT_ADAPTERS[normalizedPlatform].docs,
              client_id: values.client_id?.trim() || "",
              client_secret: values.client_secret?.trim() || "",
            }
          : {
              connection_mode: values.update_mode || "polling",
              docs: CHANNEL_AGENT_ADAPTERS[normalizedPlatform].docs,
              secret_token: values.secret_token?.trim() || "",
            };
      const payload: Partial<API.Channel> = {
        name,
        platform: normalizedPlatform,
        agent_prompt: safeTrim((values as any).agent_prompt),
        webhook_url:
          normalizedPlatform === "telegram" &&
          values.update_mode === "webhook" &&
          values.webhook_url?.trim()
            ? values.webhook_url.trim()
            : undefined,
        bot_token:
          normalizedPlatform === "telegram"
            ? values.bot_token?.trim() || undefined
            : undefined,
        metadata,
        is_enabled: 1,
      };
      const channel = await createChannel(payload);
      await refreshChannels();
      const newAgentId = `channel:${channel.id}`;
      setActiveAgentId(newAgentId);
      pushAgencyParams({ agent: newAgentId, conversationId: null });
      setChannelAgentModalVisible(false);
      channelAgentForm.resetFields();
      messageApi.success("渠道 Agent 已创建");
    } catch (error: any) {
      if (error?.errorFields) return;
      messageApi.error(error?.message || "创建渠道 Agent 失败");
    } finally {
      setCreatingChannelAgent(false);
    }
  };

  const handleCreateAcpAgent = async () => {
    try {
      const validatedValues = await acpAgentForm.validateFields();
      const values = {
        ...acpAgentForm.getFieldsValue(true),
        ...validatedValues,
      } as AcpAgentCreateFormValues;
      const name = safeTrim(values.name);
      if (!name) {
        throw new Error("请输入 Agent 名称");
      }
      const preset = values.preset || "opencode";
      setCreatingAcpAgent(true);
      const template = acpPresetMeta[preset];
      const agent = await createAcpAgent({
        name,
        preset,
        command: safeTrim(values.command) || template?.command,
        api_key: safeTrim(values.api_key) || undefined,
        agent_prompt: safeTrim(values.agent_prompt) || undefined,
        default_model_id: safeTrim(values.default_model_id) || undefined,
      });
      await refreshAcpAgents();
      const newAgentId = `acp:${agent.id}`;
      setActiveAgentId(newAgentId);
      pushAgencyParams({ agent: newAgentId, conversationId: null });
      setAcpAgentModalVisible(false);
      acpAgentForm.resetFields();
      messageApi.success("ACP Agent 已创建");
    } catch (error: any) {
      if (error?.errorFields) return;
      messageApi.error(error?.message || "创建 ACP Agent 失败");
    } finally {
      setCreatingAcpAgent(false);
    }
  };

  const handleSelectConversation = async (id: string) => {
    const targetConversation = conversations.find((item) => String(item.id) === String(id));
    const mappedAgentId = targetConversation
      ? resolveConversationAgentId(targetConversation, conversationAgentMap)
      : conversationAgentMap[String(id)] || MAIN_AGENT_ID;
    if (mappedAgentId !== activeAgentId) {
      setActiveAgentId(mappedAgentId);
    }
    setCurrentConvId(id);
    pushAgencyParams({ agent: mappedAgentId, conversationId: id });
    setToolMessageExpanded({});
    try {
      const msgs = await getMessages(id);
      setMessages(msgs);
    } catch (error) {
      console.error(error);
    }
    if (isMobile) setConversationDrawerVisible(false);
  };

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteConversation(id);
      patchConversationAgentMap((prev) => {
        const next = { ...prev };
        delete next[String(id)];
        return next;
      });
      const newConvs = conversations.filter((c) => c.id !== id);
      setConversations(newConvs);
      if (currentConvId === id) {
        if (newConvs.length > 0) {
          handleSelectConversation(newConvs[0].id);
        } else {
          setCurrentConvId(null);
          setMessages([]);
          pushAgencyParams({ conversationId: null });
        }
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleRenameStart = (conv: API.Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTitleId(conv.id);
    setEditingTitle(conv.title);
  };

  const handleRenameConfirm = async () => {
    if (!editingTitleId || !editingTitle.trim()) {
      setEditingTitleId(null);
      return;
    }
    try {
      await updateConversation(editingTitleId, editingTitle.trim());
      setConversations((prev) =>
        prev.map((c) =>
          c.id === editingTitleId ? { ...c, title: editingTitle.trim() } : c
        )
      );
    } catch (e) {
      console.error(e);
    }
    setEditingTitleId(null);
  };

  // 核心发送函数（兼容 send + regenerate）
  const streamChat = async (
    convId: string,
    userMsg: API.Message | null,
    isRegenerate = false
  ) => {
    setLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    let sawAssistantContent = false;
    let sawAssistantError = false;

    try {
      await createAssistantPlaceholder();
      const url = resolveApiUrl(
        isRegenerate
          ? `/api/conversations/${convId}/regenerate`
          : `/api/conversations/${convId}/chat`
      );

      let body: any = {};
      if (!isRegenerate && userMsg) {
        body.message =
          userMsg.content.replace(/\[IMAGE_DATA:[^\]]+\]/g, "").trim() ||
          userMsg.content;
        // 提取图片 base64
        const imgMatches = [
          ...userMsg.content.matchAll(/\[IMAGE_DATA:([^\]]+)\]/g),
        ];
        if (imgMatches.length > 0) {
          body.images = imgMatches.map((m) => m[1]);
          body.message = userMsg.content
            .replace(/\[IMAGE_DATA:[^\]]+\]/g, "")
            .trim();
        }
      }
      body.debug = debugEnabled;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...createAuthHeaders(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorMessage = await getResponseErrorMessage(response);
        replaceAssistantMessage(
          streamTargetIndexRef.current,
          `❌ ${errorMessage}`
        );
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        processSseChunk(chunk, {
          onData: (parsed) => {
            if (parsed.type === "debug") {
              appendDebugEvent(convId, parsed);
              return;
            }
            if (parsed.type === "tool_running") {
              flushStreamBuffer();
              setMessages((prev) => {
                const next = [
                  ...prev,
                  {
                    role: "tool" as const,
                    content: `🔧 正在执行工具：${parsed.tool_name}...`,
                  },
                  { role: "assistant" as const, content: "" },
                ];
                streamTargetIndexRef.current = next.length - 1;
                return next;
              });
              sawAssistantContent = false;
              sawAssistantError = false;
            } else {
              if (parsed.content) sawAssistantContent = true;
              if (parsed.error) sawAssistantError = true;
              appendAssistantChunk(parsed.content, parsed.error);
            }

            if (parsed.title) {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === convId ? { ...c, title: parsed.title } : c
                )
              );
            }
          },
        });
      }
      flushSseRemainder({
        onData: (parsed) => {
          if (parsed.type === "debug") {
            appendDebugEvent(convId, parsed);
            return;
          }
          if (parsed.type === "tool_running") {
            flushStreamBuffer();
            setMessages((prev) => {
              const next = [
                ...prev,
                {
                  role: "tool" as const,
                  content: `🔧 正在执行工具：${parsed.tool_name}...`,
                },
                { role: "assistant" as const, content: "" },
              ];
              streamTargetIndexRef.current = next.length - 1;
              return next;
            });
            sawAssistantContent = false;
            sawAssistantError = false;
          } else {
            if (parsed.content) sawAssistantContent = true;
            if (parsed.error) sawAssistantError = true;
            appendAssistantChunk(parsed.content, parsed.error);
          }

          if (parsed.title) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === convId ? { ...c, title: parsed.title } : c
              )
            );
          }
        },
      });
      flushPendingStreamSegmentsNow();
      flushStreamBuffer();
      if (!sawAssistantContent && !sawAssistantError) {
        replaceAssistantMessage(
          streamTargetIndexRef.current,
          "⚠️ 上游返回空内容，未生成可展示的回复。"
        );
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        if (debugEnabled) {
          appendDebugEvent(convId, {
            timestamp: new Date().toISOString(),
            phase: "client_error",
            error: error.message || "发送失败，请检查网络和 API 配置",
          });
        }
        if (!sawAssistantError) {
          replaceAssistantMessage(
            streamTargetIndexRef.current,
            `❌ ${error.message || "发送失败，请检查网络和 API 配置"}`
          );
        }
        messageApi.error(error.message || "发送失败，请检查网络和 API 配置");
        console.error(error);
      }
    } finally {
      flushPendingStreamSegmentsNow();
      flushStreamBuffer();
      setLoading(false);
      abortControllerRef.current = null;
      streamTargetIndexRef.current = null;
      sseRemainderRef.current = "";
      if (!controller.signal.aborted) {
        await syncConversationMessages(convId);
      }
    }
  };

  const sendMessage = async () => {
    if ((!inputText.trim() && pendingImages.length === 0) || loading) return;

    let convId = currentConvId;
    const shouldSummarizeTitle = messages.length === 0;
    if (!convId) {
      const newConv = await createConversation(
        "新对话",
        buildConversationCreateOptions(activeAgent)
      );
      setConversations((prev) => [newConv, ...prev]);
      convId = newConv.id;
      setCurrentConvId(convId);
    }

    // 构建用户消息内容（文字 + 图片标记）
    let content = inputText;
    if (pendingImages.length > 0) {
      const base64s = await Promise.all(
        pendingImages.map((p) => fileToBase64(p.file))
      );
      content += "\n" + base64s.map((b) => `[IMAGE_DATA:${b}]`).join("\n");
    }

    const userMsg: API.Message = { role: "user", content };
    const previewsToRevoke = pendingImages.map((p) => p.preview);
    shouldRefocusInputRef.current = true;
    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setPendingImages([]);
    previewsToRevoke.forEach((preview) => URL.revokeObjectURL(preview));

    await streamChat(convId, userMsg, false);

    if (shouldSummarizeTitle) {
      summarizeConversationTitle(convId).catch((e) => console.error(e));
      // 异步总结可能耗时较长，分段刷新会话列表以拿到新标题
      TITLE_REFRESH_DELAYS.forEach((delay) => {
        window.setTimeout(() => {
          refreshConversations();
        }, delay);
      });
    }
  };

  const handleRegenerate = async () => {
    if (!currentConvId || loading) return;
    // 删除界面上最后一条 assistant 消息
    setMessages((prev) => {
      const newMsgs = [...prev];
      if (
        newMsgs.length > 0 &&
        newMsgs[newMsgs.length - 1].role === "assistant"
      ) {
        newMsgs.pop();
      }
      return newMsgs;
    });
    await streamChat(currentConvId, null, true);
  };

  const handleSaveEdit = async (msgId: number) => {
    if (!currentConvId || loading || !editingMsgContent.trim()) return;

    const content = editingMsgContent;
    setEditingMsgId(null);
    setLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    let initialAssistantIndex: number | null = null;
    let sawAssistantContent = false;
    let sawAssistantError = false;

    // 截断界面消息并替换编辑的消息
    const msgIndex = messages.findIndex((m) => m.id === msgId);
    if (msgIndex !== -1) {
      const updatedMessages = messages.slice(0, msgIndex);
      const editedMsg = { ...messages[msgIndex], content };
      updatedMessages.push(editedMsg);
      // 添加空 assistant 消息占位
      updatedMessages.push({ role: "assistant", content: "" });
      setMessages(updatedMessages);
      initialAssistantIndex = updatedMessages.length - 1;
    }

    try {
      const url = resolveApiUrl(
        `/api/conversations/${currentConvId}/messages/${msgId}`
      );

      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...createAuthHeaders(),
        },
        body: JSON.stringify({
          content,
          debug: debugEnabled,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorMessage = await getResponseErrorMessage(response);
        replaceAssistantMessage(
          streamTargetIndexRef.current,
          `❌ ${errorMessage}`
        );
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      streamTargetIndexRef.current = initialAssistantIndex;
      streamBufferRef.current = "";
      streamErrorRef.current = null;
      sseRemainderRef.current = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        processSseChunk(chunk, {
          onData: (parsed) => {
            if (parsed.type === "debug") {
              appendDebugEvent(currentConvId, parsed);
              return;
            }
            if (parsed.type === "tool_running") {
              flushStreamBuffer();
              setMessages((prev) => {
                const next = [
                  ...prev,
                  {
                    role: "tool" as const,
                    content: `🔧 正在执行工具：${parsed.tool_name}...`,
                  },
                  { role: "assistant" as const, content: "" },
                ];
                streamTargetIndexRef.current = next.length - 1;
                return next;
              });
              sawAssistantContent = false;
              sawAssistantError = false;
            } else {
              if (parsed.content) sawAssistantContent = true;
              if (parsed.error) sawAssistantError = true;
              appendAssistantChunk(parsed.content, parsed.error);
            }

            if (parsed.title) {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === currentConvId ? { ...c, title: parsed.title } : c
                )
              );
            }
          },
        });
      }
      flushSseRemainder({
        onData: (parsed) => {
          if (parsed.type === "debug") {
            appendDebugEvent(currentConvId, parsed);
            return;
          }
          if (parsed.type === "tool_running") {
            flushStreamBuffer();
            setMessages((prev) => {
              const next = [
                ...prev,
                {
                  role: "tool" as const,
                  content: `🔧 正在执行工具：${parsed.tool_name}...`,
                },
                { role: "assistant" as const, content: "" },
              ];
              streamTargetIndexRef.current = next.length - 1;
              return next;
            });
            sawAssistantContent = false;
            sawAssistantError = false;
          } else {
            if (parsed.content) sawAssistantContent = true;
            if (parsed.error) sawAssistantError = true;
            appendAssistantChunk(parsed.content, parsed.error);
          }

          if (parsed.title) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === currentConvId ? { ...c, title: parsed.title } : c
              )
            );
          }
        },
      });
      flushPendingStreamSegmentsNow();
      flushStreamBuffer();
      if (!sawAssistantContent && !sawAssistantError) {
        replaceAssistantMessage(
          streamTargetIndexRef.current,
          "⚠️ 上游返回空内容，未生成可展示的回复。"
        );
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        if (debugEnabled && currentConvId) {
          appendDebugEvent(currentConvId, {
            timestamp: new Date().toISOString(),
            phase: "client_error",
            error: error.message || "发送失败，请检查网络和 API 配置",
          });
        }
        if (!sawAssistantError) {
          replaceAssistantMessage(
            streamTargetIndexRef.current,
            `❌ ${error.message || "发送失败，请检查网络和 API 配置"}`
          );
        }
        messageApi.error(error.message || "发送失败，请检查网络和 API 配置");
        console.error(error);
      }
    } finally {
      flushPendingStreamSegmentsNow();
      flushStreamBuffer();
      setLoading(false);
      abortControllerRef.current = null;
      streamTargetIndexRef.current = null;
      sseRemainderRef.current = "";
      refreshConversations();
      if (!controller.signal.aborted && currentConvId) {
        await syncConversationMessages(currentConvId);
      }
    }
  };

  const handleStop = () => {
    const convId = currentConvId;
    if (convId) {
      stopConversationExecution(convId).catch((error) => {
        console.error(error);
      });
    }
    abortControllerRef.current?.abort();
    setLoading(false);
  };

  const handleSwitchAcpModel = async (modelId: string) => {
    if (!currentConvId || !currentConversation?.acp_agent_id) return;

    try {
      setSwitchingAcpModel(true);
      const result = await setConversationAcpModel(currentConvId, modelId);
      setAcpConversationModels(result);
      setConversations((prev) =>
        prev.map((item) =>
          String(item.id) === String(currentConvId)
            ? { ...item, acp_model_id: modelId }
            : item
        )
      );
      await refreshAcpAgents();
      messageApi.success(`已切换到模型 ${modelId}`);
    } catch (error: any) {
      messageApi.error(error?.message || "切换 ACP 会话模型失败");
    } finally {
      setSwitchingAcpModel(false);
    }
  };

  const getToolMessageKey = (msg: API.Message, idx: number) => {
    if (msg.id) return `tool-${msg.id}`;
    return `tool-${idx}-${getToolMessageName(msg)}`;
  };

  const handleToggleToolMessage = (key: string) => {
    setToolMessageExpanded((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleCopyMessage = (content: string) => {
    const displayContent = extractDisplayContent(content);
    navigator.clipboard.writeText(displayContent);
    messageApi.success("已复制到剪贴板");
  };

  const handleImageAdd = (file: File) => {
    const preview = URL.createObjectURL(file);
    setPendingImages((prev) => [...prev, { file, preview }]);
    return false; // 阻止 antd Upload 自动上传
  };

  const handleInputPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles = items
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (imageFiles.length === 0) return;

    setPendingImages((prev) => [
      ...prev,
      ...imageFiles.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      })),
    ]);
    messageApi.success(`已粘贴 ${imageFiles.length} 张图片`);
  };

  const handleImageRemove = (index: number) => {
    setPendingImages((prev) => {
      const target = prev[index];
      if (target?.preview) {
        URL.revokeObjectURL(target.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const filteredConversations = conversations
    .filter((conversation) => {
      const mappedAgentId = resolveConversationAgentId(
        conversation,
        conversationAgentMap
      );
      return mappedAgentId === (activeAgent?.id || MAIN_AGENT_ID);
    })
    .filter((conversation) =>
      conversation.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  const extensionByPlatform = useMemo(
    () => new Map(channelExtensions.map((item) => [item.platform, item])),
    [channelExtensions]
  );

  useEffect(() => {
    if (!currentConvId) return;
    const currentConversation = conversations.find(
      (item) => String(item.id) === String(currentConvId)
    );
    const currentAgentForConversation = currentConversation
      ? resolveConversationAgentId(currentConversation, conversationAgentMap)
      : conversationAgentMap[String(currentConvId)] || MAIN_AGENT_ID;
    if (currentAgentForConversation !== (activeAgent?.id || MAIN_AGENT_ID)) {
      setCurrentConvId(null);
      setMessages([]);
    }
  }, [activeAgent, conversationAgentMap, conversations, currentConvId]);

  useEffect(() => {
    if (!showAgencyOverview) return;
    setCurrentConvId(null);
    setMessages([]);
  }, [showAgencyOverview]);

  useEffect(() => {
    if (!currentConversation?.acp_agent_id || !currentConvId) {
      setAcpConversationModels(null);
      setAcpModelsLoading(false);
      return;
    }

    loadAcpConversationModels(String(currentConvId)).catch(() => undefined);
  }, [currentConversation?.acp_agent_id, currentConvId, loadAcpConversationModels]);

  useEffect(() => {
    if (!currentConvId) {
      setConversationBudget(null);
      setConversationBudgetLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      if (!loading) {
        refreshConversationBudget(String(currentConvId)).catch(() => undefined);
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [
    currentConvId,
    currentConversation?.context_window,
    currentConversation?.acp_model_id,
    loading,
    messages,
    refreshConversationBudget,
  ]);

  const currentDebugEvents = currentConvId
    ? debugEventsByConversation[currentConvId] || []
    : [];
  const visibleMessages = messages.filter(
    (msg) =>
      !msg.is_hidden &&
      !(
        msg.role === "assistant" &&
        !msg.content &&
        Array.isArray(msg.tool_calls) &&
        msg.tool_calls.length > 0
      )
  );

  const moduleNavContent = (
    <Sidebar
      moduleExpanded={moduleExpanded}
      setModuleExpanded={setModuleExpanded}
      themeMode={themeMode}
      resolvedTheme={resolvedTheme}
      setThemeMode={setThemeMode}
      activePath="/agency"
    />
  );

  const agencyOverviewContent = (
    <div className="agency-overview">
      <div className="agency-overview-hero">
        <div>
          <div className="agency-overview-eyebrow">Agency</div>
          <h1>当前已配置的 Agents</h1>
          <p>
            先选 Agent，再进入它的独立会话空间。主工作台 `main`
            、渠道机器人和外部 ACP Agent 都在这里统一管理。
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              channelAgentForm.setFieldsValue({
                name: "",
                agent_prompt: "",
                platform: availableChannelPlatforms[0],
                update_mode: "polling",
                bot_token: "",
              });
              setChannelAgentModalVisible(true);
            }}
          >
            新增渠道 Agent
          </Button>
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              acpAgentForm.setFieldsValue({
                name: "",
                preset: "opencode",
                command: acpPresetMeta.opencode?.command || "opencode",
                api_key: "",
                agent_prompt: "",
                default_model_id: "",
              });
              setAcpAgentModalVisible(true);
            }}
          >
            新增 ACP Agent
          </Button>
        </div>
      </div>

      <div className="agency-agent-grid">
        {agents.map((agent) => {
          const conversationCount = conversations.filter((conversation) => {
            const mappedAgentId = resolveConversationAgentId(
              conversation,
              conversationAgentMap
            );
            return mappedAgentId === agent.id;
          }).length;

          return (
            <div
              key={agent.id}
              className="agency-agent-card"
              onClick={() => handleOpenAgent(agent.id)}
            >
              <div className="agency-agent-card-top">
                <div>
                  <div className="agency-agent-card-name">{agent.name}</div>
                  <div className="agency-agent-card-desc">{agent.description}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Tag bordered={false} className="agent-item-kind">
                    {agent.kind === "main"
                      ? "web"
                      : agent.kind === "acp"
                        ? acpPresetMeta[agent.preset || ""]?.label || "ACP"
                        : CHANNEL_AGENT_ADAPTERS[agent.platform || ""]?.label ||
                          agent.platform}
                  </Tag>
                  <Tooltip title="Agent 设置">
                    <Button
                      type="text"
                      size="small"
                      icon={<SettingOutlined />}
                      onClick={(event) => {
                        event.stopPropagation();
                        openAgentSettings(agent).catch(() => undefined);
                      }}
                    />
                  </Tooltip>
                  {agent.kind !== "main" && (
                    <Popconfirm
                      title={`删除 ${agent.name}`}
                      description="删除后不会清理已存在的会话，但新的入口会被移除。"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={(event) => {
                        event?.stopPropagation?.();
                        return handleDeleteAgent(agent);
                      }}
                      onCancel={(event) => event?.stopPropagation?.()}
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        loading={deletingAgentId === agent.id}
                        icon={<DeleteOutlined />}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Popconfirm>
                  )}
                </div>
              </div>
              <div className="agency-agent-card-meta">
                <span>{conversationCount} 个会话</span>
                <span>
                  {agent.kind === "main"
                    ? "内置工作台"
                    : agent.kind === "acp"
                      ? "ACP 连接器"
                    : getListenerStatusText(agent.listenerState)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const conversationListContent = (
    <div className={`conversation-panel ${isDark ? "dark" : ""}`}>
      <div className="conversation-panel-header">
        <div className="conversation-panel-title">
          <AppstoreOutlined />
          <span>{activeAgent?.name || "main"}</span>
        </div>
      </div>

      <div className="agent-conversation-head">
        <span className="agency-section-title">会话列表</span>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          size="small"
          onClick={handleCreateChat}
          title="新会话 (Ctrl+N)"
        >
          新会话
        </Button>
      </div>
      <Input.Search
        placeholder="搜索当前 Agent 会话..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        allowClear
        size="small"
        className="conversation-search"
      />
      {activeAgent?.kind === "channel" && (
        <div className="agent-binding-tip">
          渠道绑定: {activeAgent.platform} ·{" "}
          {CHANNEL_AGENT_ADAPTERS[activeAgent.platform || ""]?.connectionLabel}
          {" · "}
          {getListenerStatusText(activeAgent.listenerState)}
          {" · "}
          <a
            href={
              extensionByPlatform.get(activeAgent.platform || "")?.metadata?.docs ||
              CHANNEL_AGENT_ADAPTERS[activeAgent.platform || ""]?.docs
            }
            target="_blank"
            rel="noreferrer"
          >
            官方文档
          </a>
        </div>
      )}

      {activeAgent?.kind === "channel" && (
        <div className="agent-item active" style={{ cursor: "default" }}>
          <div className="agent-item-main">
            <span className="agent-item-name">
              {CHANNEL_AGENT_ADAPTERS[activeAgent.platform || ""]?.label}
            </span>
            <Tag className="agent-item-kind" bordered={false}>
              {CHANNEL_AGENT_ADAPTERS[activeAgent.platform || ""]?.connectionLabel}
            </Tag>
          </div>
          <div className="agent-item-desc">
            {CHANNEL_AGENT_ADAPTERS[activeAgent.platform || ""]?.description}
            {activeAgent.listenerState?.lastError
              ? ` 当前状态: ${activeAgent.listenerState.lastError}`
              : ""}
          </div>
        </div>
      )}

      <div className="conversation-scroll">
        {filteredConversations.map((conv) => (
          <div
            key={conv.id}
            className={`conversation-item ${currentConvId === conv.id ? "active" : ""
              }`}
            onClick={() => handleSelectConversation(conv.id)}
          >
            {editingTitleId === conv.id ? (
              <div className="title-edit" onClick={(e) => e.stopPropagation()}>
                <Input
                  size="small"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onPressEnter={handleRenameConfirm}
                  autoFocus
                />
                <Button
                  type="text"
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={handleRenameConfirm}
                />
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={() => setEditingTitleId(null)}
                />
              </div>
            ) : (
              <>
                <span className="conv-title">{conv.title}</span>
                <div className="conv-actions">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    className="action-btn"
                    onClick={(e) => handleRenameStart(conv, e)}
                  />
                  <Popconfirm
                    title="删除对话"
                    description="确定要删除这个对话吗？"
                    onConfirm={(e) =>
                      handleDeleteConversation(conv.id, e as any)
                    }
                    onCancel={(e) => (e as any)?.stopPropagation()}
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      className="action-btn delete-btn"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                </div>
              </>
            )}
          </div>
        ))}
        {filteredConversations.length === 0 && (
          <div className="empty-conv">
            当前 Agent 暂无会话，先创建一条新会话。
          </div>
        )}
      </div>
    </div>
  );

  const agentEmptyContent = (
    <div className="empty-messages">
      <div className="empty-icon">◌</div>
      <div className="empty-title">{activeAgent?.name || "main"} 还没有打开会话</div>
      <div className="empty-hint">
        先创建一条新会话，再进入这个 Agent 的聊天上下文。
      </div>
      <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateChat}>
        新建会话
      </Button>
    </div>
  );

  const lastAssistantIdx = [...visibleMessages]
    .map((m) => m.role)
    .lastIndexOf("assistant");
  const latestDebugIssue = getLatestDebugIssue(currentDebugEvents);
  const budgetPercent = Math.max(
    0,
    Math.min(100, Number(conversationBudget?.remaining_percentage || 0))
  );
  const budgetStatus: "success" | "normal" | "exception" =
    budgetPercent >= 70 ? "success" : budgetPercent >= 50 ? "normal" : "exception";
  const budgetHint =
    budgetPercent < 50
      ? "已进入三段式压缩区间：近处轻压缩，中段中压缩，远处深压缩。"
      : "上下文空间充足，系统会优先保留最近对话原貌。";

  return (
    <ConfigProvider
      wave={{ disabled: true }}
      theme={{
        algorithm: isDark
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm,
        token: {
          motion: false,
        },
      }}
    >
      {messageContextHolder}
      <div
        className={`chat-layout cw-dashboard-layout ${isDark ? "dark" : ""}`}
      >
        {moduleNavContent}
        {isMobile && !showAgencyOverview && (
          <Drawer
            placement="right"
            open={conversationDrawerVisible}
            onClose={() => setConversationDrawerVisible(false)}
            width={320}
            styles={{ body: { padding: 0 } }}
            title={null}
          >
            {conversationListContent}
          </Drawer>
        )}

        <main className="chat-content" style={{ flex: 1, minWidth: 0 }}>
          <div className="chat-header">
            <div className="header-left">
              {!showAgencyOverview && (
                <Button
                  type="text"
                  size="small"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => pushAgencyParams({ agent: null, conversationId: null })}
                >
                  返回 Agency
                </Button>
              )}
              <span className="header-title">
                {showAgencyOverview
                  ? "Agency"
                  : `${activeAgent?.name || "main"} · 会话`}
              </span>
              {!showAgencyOverview && activeAgent && (
                <Tooltip title="编辑当前 Agent 的独立提示词与配置">
                  <Button
                    type="text"
                    size="small"
                    icon={<SettingOutlined />}
                    onClick={() => openAgentSettings(activeAgent).catch(() => undefined)}
                  >
                    Agent 设置
                  </Button>
                </Tooltip>
              )}
              {!showAgencyOverview && activeAgent?.kind !== "main" && (
                <Popconfirm
                  title={`删除 ${activeAgent?.name}`}
                  description="删除后会返回 main，现有会话记录会保留。"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => handleDeleteAgent(activeAgent)}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    loading={deletingAgentId === activeAgent?.id}
                    icon={<DeleteOutlined />}
                  >
                    删除 Agent
                  </Button>
                </Popconfirm>
              )}
              {currentConvId && (
                <Tooltip title="查看本次对话的模型调试输出">
                  <Button
                    type="text"
                    size="small"
                    icon={<BugOutlined />}
                    onClick={() => setDebugDrawerVisible(true)}
                    style={{
                      color: debugEnabled ? "#ef4444" : undefined,
                      fontWeight: debugEnabled ? 600 : undefined,
                    }}
                  >
                    {debugEnabled ? "调试开启" : "开发者调试"}
                  </Button>
                </Tooltip>
              )}
              {currentConvId && (
                <Tooltip title="立即终止当前会话与工具执行">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<StopOutlined />}
                    onClick={handleStop}
                    disabled={!loading}
                  >
                    一键停机
                  </Button>
                </Tooltip>
              )}
              {currentConvId && currentConversation?.acp_agent_id && (
                <Select
                  size="small"
                  loading={acpModelsLoading || switchingAcpModel}
                  value={
                    acpConversationModels?.current_model_id ||
                    currentConversation.acp_model_id ||
                    undefined
                  }
                  placeholder="选择 ACP 模型"
                  style={{ minWidth: 220 }}
                  options={(acpConversationModels?.available_models || []).map((item) => ({
                    value: item.model_id,
                    label: item.name || item.model_id,
                  }))}
                  onChange={handleSwitchAcpModel}
                  disabled={
                    loading ||
                    !acpConversationModels?.supports_switching ||
                    (acpConversationModels?.available_models || []).length === 0
                  }
                />
              )}
            </div>
            <div className="header-right">
              {isMobile && !showAgencyOverview && (
                <Tooltip title="Agency / Agents">
                  <Button
                    type="text"
                    icon={<AppstoreOutlined />}
                    onClick={() => setConversationDrawerVisible(true)}
                  />
                </Tooltip>
              )}
              <span className="header-username">{currentUser?.username}</span>
              <Avatar
                style={{ backgroundColor: "#2563eb" }}
                icon={<UserOutlined />}
              >
                {currentUser?.username?.[0]?.toUpperCase()}
              </Avatar>
            </div>
          </div>

          {showAgencyOverview ? (
            <div className="chat-main">
              <div className="chat-center">
                <div className="messages-area agency-overview-scroll">
                  {agencyOverviewContent}
                </div>
              </div>
            </div>
          ) : (
            <div className="chat-main">
              <div className="chat-center">
              <div 
                className="messages-area" 
                ref={messagesAreaRef}
                onScroll={handleScroll}
              >
                {!currentConvId ? (
                  agentEmptyContent
                ) : messages.length === 0 ? (
                  <div className="empty-messages">
                    <div className="empty-icon">✨</div>
                    <div className="empty-title">有什么我可以帮你的？</div>
                    <div className="empty-hint">按 Ctrl+N 创建新对话</div>
                  </div>
                ) : (
                  visibleMessages.map((msg, idx) => (
                    <div key={idx} className={`message-row ${msg.role}`}>
                      {msg.role === "assistant" && (
                        <Avatar
                          className="msg-avatar assistant-avatar"
                          size={32}
                        >
                          AI
                        </Avatar>
                      )}
                      {msg.role === "tool" && (
                        <Avatar className="msg-avatar tool-avatar" size={32}>
                          <ToolOutlined />
                        </Avatar>
                      )}
                      <div className={`message-bubble ${msg.role} ${
                        loading && idx === lastAssistantIdx ? "no-animation" : ""
                      }`}>
                        {msg.role === "user" ? (
                          <div className="user-content">
                            {hasImage(msg.content) && (
                              <div className="image-preview-row">📷 图片</div>
                            )}
                            {editingMsgId === msg.id ? (
                              <div className="edit-message-container">
                                <Input.TextArea
                                  autoSize={{ minRows: 2, maxRows: 10 }}
                                  value={editingMsgContent}
                                  onChange={(e) =>
                                    setEditingMsgContent(e.target.value)
                                  }
                                  className="edit-message-input"
                                  disabled={loading}
                                />
                                <div
                                  className="edit-message-actions"
                                  style={{ marginTop: 8, textAlign: "right" }}
                                >
                                  <Button
                                    size="small"
                                    onClick={() => setEditingMsgId(null)}
                                    disabled={loading}
                                    style={{ marginRight: 8 }}
                                  >
                                    取消
                                  </Button>
                                  <Button
                                    size="small"
                                    type="primary"
                                    onClick={() => handleSaveEdit(msg.id!)}
                                    loading={loading}
                                  >
                                    发送 / 重新生成
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              extractDisplayContent(msg.content)
                            )}
                          </div>
                        ) : msg.role === "tool" ? (
                          (() => {
                            const status = getToolMessageStatus(msg);
                            const messageKey = getToolMessageKey(msg, idx);
                            const isExpanded =
                              status === "running" || toolMessageExpanded[messageKey];
                            const fullContent = extractDisplayContent(msg.content);
                            return (
                              <div className={`tool-message-card ${status}`}>
                                <div className="tool-message-header">
                                  <span className="tool-message-name">
                                    {getToolMessageName(msg)}
                                  </span>
                                  <span className="tool-message-status">
                                    {status === "running"
                                      ? "运行中"
                                      : status === "error"
                                        ? "失败"
                                        : "完成"}
                                  </span>
                                </div>
                                <div className="tool-message-controls">
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={isExpanded ? <UpOutlined /> : <DownOutlined />}
                                    disabled={status === "running"}
                                    onClick={() => handleToggleToolMessage(messageKey)}
                                  >
                                    {isExpanded ? "收起输出" : "展开输出"}
                                  </Button>
                                </div>
                                <pre
                                  className={`tool-message-body ${isExpanded ? "expanded" : "collapsed"
                                    }`}
                                >
                                  {fullContent}
                                </pre>
                              </div>
                            );
                          })()
                        ) : (
                          <div
                            className={
                              loading && idx === lastAssistantIdx
                                ? "assistant-streaming"
                                : ""
                            }
                          >
                            {msg.content ? (
                              <div
                                className="stream-fade-shell"
                                data-streaming={
                                  loading && idx === lastAssistantIdx
                                }
                              >
                                <MarkdownRenderer
                                  content={msg.content}
                                  isDark={isDark}
                                  expandThinking={
                                    loading && idx === lastAssistantIdx
                                  }
                                />
                              </div>
                            ) : (
                              <>
                                {loading && idx === lastAssistantIdx ? (
                                  <div className="typing-placeholder">
                                    <span>AI 正在思考</span>
                                    <span className="typing-dots">
                                      <i />
                                      <i />
                                      <i />
                                    </span>
                                  </div>
                                ) : (
                                  <div
                                    style={{
                                      color: "var(--text-tertiary)",
                                      fontSize: 14,
                                    }}
                                  >
                                    ⚠️
                                    这条回复未完成（可能因刷新或上游中断），请点击重新生成。
                                    {idx === lastAssistantIdx && latestDebugIssue && (
                                      <pre
                                        style={{
                                          marginTop: 10,
                                          whiteSpace: "pre-wrap",
                                          wordBreak: "break-word",
                                          padding: 10,
                                          borderRadius: 10,
                                          background: "rgba(148, 163, 184, 0.12)",
                                          color: "var(--text-secondary)",
                                          fontSize: 12,
                                        }}
                                      >
                                        {formatDebugIssueText(latestDebugIssue)}
                                      </pre>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <div className={`msg-actions ${msg.role}`}>
                        <Tooltip title="复制">
                          <Button
                            type="text"
                            size="small"
                            icon={<CopyOutlined />}
                            onClick={() => handleCopyMessage(msg.content)}
                            className="msg-action-btn"
                          />
                        </Tooltip>
                        {msg.role === "user" && msg.id && !loading && (
                          <Tooltip title="编辑">
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined />}
                              onClick={() => {
                                setEditingMsgId(msg.id!);
                                setEditingMsgContent(
                                  extractDisplayContent(msg.content)
                                );
                              }}
                              className="msg-action-btn"
                            />
                          </Tooltip>
                        )}
                        {msg.role === "assistant" &&
                          idx === lastAssistantIdx &&
                          !loading && (
                            <Tooltip title="重新生成">
                              <Button
                                type="text"
                                size="small"
                                icon={<ReloadOutlined />}
                                onClick={handleRegenerate}
                                className="msg-action-btn"
                              />
                            </Tooltip>
                          )}
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {currentConvId && (
                <div className="input-area">
                {pendingImages.length > 0 && (
                  <div className="pending-images">
                    {pendingImages.map((img, i) => (
                      <div key={i} className="pending-image-item">
                        <img src={img.preview} alt="upload" />
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<CloseOutlined />}
                          className="remove-image-btn"
                          onClick={() => handleImageRemove(i)}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {contextBudgetExpanded ? (
                  <div className="context-budget-panel">
                    <div className="context-budget-row">
                      <div>
                        <div className="context-budget-title">
                          Context 空间剩余
                          {conversationBudgetLoading && (
                            <span className="context-budget-loading">计算中...</span>
                          )}
                        </div>
                        <div className="context-budget-meta">
                          {conversationBudget
                            ? `${conversationBudget.remaining_tokens.toLocaleString()} / ${conversationBudget.context_window.toLocaleString()} tokens`
                            : "发送后会自动估算本会话上下文空间"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <Button
                          size="small"
                          icon={<ReloadOutlined />}
                          onClick={handleManualCompact}
                          loading={compactingConversation}
                          disabled={!currentConvId || loading}
                        >
                          手动 Compact
                        </Button>
                        <Button
                          type="text"
                          size="small"
                          icon={<UpOutlined />}
                          onClick={() => setContextBudgetExpanded(false)}
                        />
                      </div>
                    </div>
                    <Progress
                      percent={budgetPercent}
                      size="small"
                      status={budgetStatus}
                      showInfo
                      format={(percent) => `${Number(percent || 0).toFixed(0)}%`}
                    />
                    <div
                      className={`context-budget-hint ${
                        budgetPercent < 50 ? "warning" : ""
                      }`}
                    >
                      {budgetHint}
                    </div>
                  </div>
                ) : (
                  <div
                    className={`context-budget-indicator ${
                      budgetPercent < 50 ? "warning" : budgetPercent >= 70 ? "good" : ""
                    }`}
                    onClick={() => setContextBudgetExpanded(true)}
                  >
                    <span className="context-budget-indicator-dot" />
                    <span className="context-budget-indicator-label">
                      Context{" "}
                      {conversationBudget
                        ? `${Number(budgetPercent).toFixed(0)}%`
                        : "—"}
                    </span>
                    {conversationBudgetLoading && (
                      <span className="context-budget-loading">计算中...</span>
                    )}
                    <DownOutlined style={{ fontSize: 10, opacity: 0.45 }} />
                  </div>
                )}

                <div className="input-container">
                  <Tooltip title="上传图片">
                    <Upload
                      accept="image/*"
                      showUploadList={false}
                      beforeUpload={handleImageAdd}
                      multiple
                    >
                      <Button
                        type="text"
                        icon={<PictureOutlined />}
                        className="input-action-btn"
                        disabled={loading}
                      />
                    </Upload>
                  </Tooltip>

                  <TextArea
                    ref={inputRef as any}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onPaste={handleInputPaste}
                    onPressEnter={(e) => {
                      if (!e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="问问 CW… (Shift+Enter 换行 / Enter 发送)"
                    autoSize={{ minRows: 1, maxRows: 6 }}
                    variant="borderless"
                    disabled={loading}
                    className="chat-input chat-input-textarea"
                  />

                  {loading ? (
                    <Tooltip title="停止生成">
                      <Button
                        danger
                        shape="circle"
                        icon={<StopOutlined />}
                        onClick={handleStop}
                        className="send-btn"
                      />
                    </Tooltip>
                  ) : (
                    <Button
                      type="primary"
                      shape="circle"
                      icon={<SendOutlined />}
                      disabled={!inputText.trim() && pendingImages.length === 0}
                      onClick={sendMessage}
                      className="send-btn"
                    />
                  )}
                </div>
                </div>
              )}
              </div>

              {!isMobile && conversationListContent}
            </div>
          )}
        </main>

        <Modal
          title="新增渠道 Agent"
          open={channelAgentModalVisible}
          onCancel={() => setChannelAgentModalVisible(false)}
          onOk={handleCreateChannelAgent}
          confirmLoading={creatingChannelAgent}
          okText="创建"
          destroyOnHidden
        >
          <Form
            form={channelAgentForm}
            layout="vertical"
            initialValues={{
              name: "",
              agent_prompt: "",
              platform: availableChannelPlatforms[0],
              update_mode: "polling",
              bot_token: "",
            }}
          >
            <Form.Item
              label="Agent 名称"
              name="name"
              rules={[{ required: true, message: "请输入 Agent 名称" }]}
            >
              <Input placeholder="例如：telegram-notify" maxLength={64} />
            </Form.Item>
            <Form.Item
              label="Agent 提示词（可选）"
              name="agent_prompt"
              extra="这段提示词只作用于当前 Agent，不影响全局系统提示词。"
            >
              <Input.TextArea
                placeholder="例如：你是一个专注于处理渠道消息的通知机器人，输出要简洁、结构化。"
                autoSize={{ minRows: 3, maxRows: 6 }}
              />
            </Form.Item>
            <Form.Item
              label="渠道平台"
              name="platform"
              rules={[{ required: true, message: "请选择渠道平台" }]}
            >
              <Select
                options={availableChannelPlatforms.map((platform) => ({
                  value: platform,
                  label: CHANNEL_AGENT_ADAPTERS[platform]?.label || platform,
                }))}
              />
            </Form.Item>
            <Form.Item shouldUpdate noStyle>
              {({ getFieldValue }) => {
                const platform = getFieldValue("platform");
                const normalizedPlatform =
                  platform === "dingding" ? "dingtalk" : platform;
                const adapter = CHANNEL_AGENT_ADAPTERS[normalizedPlatform];
                return (
                  <>
                    <div className="agent-binding-tip" style={{ marginTop: -4 }}>
                      接入方式: {adapter?.connectionLabel}
                      {adapter?.docs ? (
                        <>
                          {" · "}
                          <a href={adapter.docs} target="_blank" rel="noreferrer">
                            官方文档
                          </a>
                        </>
                      ) : null}
                    </div>

                    {normalizedPlatform === "dingtalk" && (
                      <>
                        <Form.Item
                          label="Client ID"
                          name="client_id"
                          rules={[{ required: true, message: "请输入 Client ID" }]}
                        >
                          <Input placeholder="钉钉应用 Client ID" />
                        </Form.Item>
                        <Form.Item
                          label="Client Secret"
                          name="client_secret"
                          rules={[{ required: true, message: "请输入 Client Secret" }]}
                        >
                          <Input.Password placeholder="钉钉应用 Client Secret" />
                        </Form.Item>
                      </>
                    )}

                    {normalizedPlatform === "telegram" && (
                      <>
                        <Form.Item
                          label="Bot Token"
                          name="bot_token"
                          rules={[{ required: true, message: "请输入 Telegram Bot Token" }]}
                        >
                          <Input.Password placeholder="123456:ABC-DEF..." />
                        </Form.Item>
                        <Form.Item label="更新接入方式" name="update_mode">
                          <Segmented
                            block
                            options={[
                              { label: "长轮询 getUpdates", value: "polling" },
                              { label: "Webhook", value: "webhook" },
                            ]}
                          />
                        </Form.Item>
                        {getFieldValue("update_mode") === "webhook" && (
                          <>
                            <Form.Item
                              label="Webhook 地址"
                              name="webhook_url"
                              rules={[{ required: true, message: "请输入 Webhook 地址" }]}
                            >
                              <Input placeholder="https://your-domain/bot/telegram" />
                            </Form.Item>
                            <Form.Item label="Secret Token" name="secret_token">
                              <Input.Password placeholder="可选，用于验证 Telegram 请求" />
                            </Form.Item>
                          </>
                        )}
                      </>
                    )}
                  </>
                );
              }}
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title="新增 ACP Agent"
          open={acpAgentModalVisible}
          onCancel={() => setAcpAgentModalVisible(false)}
          onOk={handleCreateAcpAgent}
          confirmLoading={creatingAcpAgent}
          okText="创建"
          destroyOnHidden
        >
          <Form
            form={acpAgentForm}
            layout="vertical"
            initialValues={{
              name: "",
              preset: "opencode",
              command: acpPresetMeta.opencode?.command || "opencode",
              agent_prompt: "",
              default_model_id: "",
            }}
          >
            <Form.Item
              label="Agent 名称"
              name="name"
              rules={[{ required: true, message: "请输入 Agent 名称" }]}
            >
              <Input placeholder="例如：opencode-main" maxLength={64} />
            </Form.Item>
            <Form.Item
              label="Agent 提示词（可选）"
              name="agent_prompt"
              extra="这段提示词会在 ACP 会话启动、恢复和历史重放时优先生效。"
            >
              <Input.TextArea
                placeholder="例如：你是一个偏工程实现型的外部编码 Agent，优先给出可执行改动。"
                autoSize={{ minRows: 3, maxRows: 6 }}
              />
            </Form.Item>
            <Form.Item
              label="ACP 实现"
              name="preset"
              rules={[{ required: true, message: "请选择 ACP 实现" }]}
            >
              <Select
                onChange={(value: API.AcpAgent["preset"]) => {
                  const template = acpPresetMeta[value];
                  if (template) {
                    acpAgentForm.setFieldValue("command", template.command);
                  }
                }}
                options={(acpAgentTemplates || []).map((item) => ({
                  value: item.id,
                  label: item.label,
                }))}
              />
            </Form.Item>
            <Form.Item shouldUpdate noStyle>
              {({ getFieldValue }) => {
                const preset = getFieldValue("preset") as API.AcpAgent["preset"];
                const template = acpPresetMeta[preset];
                return (
                  <>
                    <div className="agent-binding-tip" style={{ marginTop: -4 }}>
                      {template?.description || "通过 ACP 协议接入外部编码 Agent"}
                      {template?.docs ? (
                        <>
                          {" · "}
                          <a href={template.docs} target="_blank" rel="noreferrer">
                            官方文档
                          </a>
                        </>
                      ) : null}
                    </div>
                    <Form.Item
                      label="启动命令"
                      name="command"
                      rules={[{ required: true, message: "请输入可执行命令" }]}
                    >
                      <Input placeholder={template?.command || "opencode"} />
                    </Form.Item>
                    <Form.Item
                      label={`${template?.env_key || "API_KEY"}（可选）`}
                      name="api_key"
                    >
                      <Input.Password placeholder="如已在系统环境变量中配置可留空" />
                    </Form.Item>
                    <Form.Item
                      label="默认模型 ID（可选）"
                      name="default_model_id"
                      extra="如果外部 ACP Agent 支持 session model 切换，将在建会话后自动切到这个模型。"
                    >
                      <Input placeholder="例如：gpt-5 / claude-sonnet-4 / o4-mini" />
                    </Form.Item>
                  </>
                );
              }}
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title={
            settingsAgent?.kind === "main"
              ? "main Agent 设置"
              : `Agent 设置 · ${settingsAgent?.name || ""}`
          }
          open={agentSettingsVisible}
          onCancel={() => {
            setAgentSettingsVisible(false);
            setSettingsAgentId(null);
            agentSettingsForm.resetFields();
          }}
          onOk={handleSaveAgentSettings}
          confirmLoading={savingAgentSettings}
          okText="保存"
          destroyOnHidden
        >
          <Form form={agentSettingsForm} layout="vertical">
            {settingsAgent?.kind !== "main" && (
              <Form.Item
                label="Agent 名称"
                name="name"
                rules={[{ required: true, message: "请输入 Agent 名称" }]}
              >
                <Input maxLength={64} />
              </Form.Item>
            )}
            <Form.Item
              label="独立 Agent 提示词"
              name="agent_prompt"
              extra="会叠加在全局系统提示词之前，只对当前 Agent 生效。"
            >
              <Input.TextArea
                placeholder="输入当前 Agent 的专属行为约束、角色定位或执行偏好"
                autoSize={{ minRows: 6, maxRows: 12 }}
              />
            </Form.Item>
            {settingsAgent?.kind === "acp" && (
              <Form.Item
                label="默认模型 ID"
                name="default_model_id"
                extra="新建 ACP 会话时会优先使用上次使用模型；没有历史时再回退到这里。"
              >
                <Input placeholder="例如：gpt-5 / claude-sonnet-4 / o4-mini" />
              </Form.Item>
            )}
            {settingsAgent?.kind === "acp" && (
              <div className="agent-binding-tip" style={{ marginTop: -4 }}>
                最近一次使用模型：
                {acpAgents.find((item) => item.id === settingsAgent.acpAgentId)
                  ?.last_used_model_id || "暂无"}
                。新建对话会优先选中它，再回退到默认模型。
              </div>
            )}
          </Form>
        </Modal>
        <Drawer
          title="开发者调试"
          placement="right"
          width={520}
          open={debugDrawerVisible}
          onClose={() => setDebugDrawerVisible(false)}
        >
          <div style={{ display: "grid", gap: 12 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>采集模型交互流</div>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                  开启后会记录本页后续请求的原始调试事件、上游 chunk、工具调用和错误。
                </div>
              </div>
              <Switch checked={debugEnabled} onChange={setDebugEnabled} />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                当前对话已记录 {currentDebugEvents.length} 条调试事件
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Button
                  size="small"
                  danger
                  onClick={handleStop}
                  disabled={!loading || !currentConvId}
                >
                  一键停机
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    if (!currentConvId) return;
                    setDebugEventsByConversation((prev) => ({
                      ...prev,
                      [currentConvId]: [],
                    }));
                  }}
                  disabled={!currentConvId || currentDebugEvents.length === 0}
                >
                  清空
                </Button>
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {currentDebugEvents.length === 0 ? (
                <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
                  暂无调试事件。开启开关后重新发送、重试或编辑消息即可看到完整流。
                </div>
              ) : (
                currentDebugEvents.map((event) => (
                  <div
                    key={event.id}
                    style={{
                      border: "1px solid var(--border-light)",
                      borderRadius: 12,
                      padding: 12,
                      background: "var(--card-bg, transparent)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        marginBottom: 8,
                        fontSize: 12,
                      }}
                    >
                      <strong>{event.phase || event.type || "debug"}</strong>
                      <span style={{ color: "var(--text-tertiary)" }}>
                        {event.timestamp
                          ? new Date(event.timestamp).toLocaleTimeString()
                          : "-"}
                      </span>
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: "var(--text-secondary)",
                      }}
                    >
                      {JSON.stringify(event, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </Drawer>
      </div>
    </ConfigProvider>
  );
};
