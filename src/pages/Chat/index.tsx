import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ModelCompareModal } from "@/components/ModelCompareModal";
import { Sidebar } from "@/components/Sidebar";
import { SystemPromptModal } from "@/components/SystemPromptModal";
import {
  createConversation,
  deleteConversation,
  getAvailableModels,
  getConversations,
  getEndpoints,
  getMcpTools,
  getMessages,
  summarizeConversationTitle,
  updateConversation,
} from "@/services/api";
import {
  AppstoreOutlined,
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  MenuOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  SlidersOutlined,
  StopOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppStore } from "@/stores/useAppStore";
import { createAuthHeaders, resolveApiUrl } from "@/services/request";
import {
  Avatar,
  Button,
  ConfigProvider,
  Drawer,
  Input,
  Layout,
  Popconfirm,
  Popover,
  Select,
  Slider,
  Switch,
  Tooltip,
  Upload,
  message as antdMessage,
  theme as antdTheme,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import "./index.css";

const { Sider, Content } = Layout;
const { TextArea } = Input;

const STORAGE_KEYS = {
  theme: "cw-theme",
  legacyTheme: "timo-theme",
  temperature: "cw.temperature",
  legacyTemperature: "timo.temperature",
  topP: "cw.top_p",
  legacyTopP: "timo.top_p",
  maxTokens: "cw.max_tokens",
  legacyMaxTokens: "timo.max_tokens",
  selectedModelPrefix: "cw.selected_model.",
  legacySelectedModelPrefix: "timo.selected_model.",
};

// 从 localStorage 获取/保存主题
const getStoredTheme = (): "light" | "dark" => {
  const saved =
    localStorage.getItem(STORAGE_KEYS.theme) ||
    localStorage.getItem(STORAGE_KEYS.legacyTheme);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const getStoredNumber = (
  key: string,
  fallback: number,
  legacyKey?: string
): number => {
  const raw =
    localStorage.getItem(key) ??
    (legacyKey ? localStorage.getItem(legacyKey) : null);
  const stored = Number(raw);
  return Number.isFinite(stored) ? stored : fallback;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getStoredString = (key: string, legacyKey?: string): string => {
  return (
    localStorage.getItem(key) ||
    (legacyKey ? localStorage.getItem(legacyKey) || "" : "")
  );
};

const getStoredBoolean = (key: string, fallback: boolean): boolean => {
  const value = localStorage.getItem(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
};

const getModelStorageKey = (endpointId: number | null) =>
  endpointId ? `${STORAGE_KEYS.selectedModelPrefix}${endpointId}` : "";

const getLegacyModelStorageKey = (endpointId: number | null) =>
  endpointId ? `${STORAGE_KEYS.legacySelectedModelPrefix}${endpointId}` : "";

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

const STREAM_FLUSH_INTERVAL = 16;
const STREAM_SEGMENT_DRAIN_INTERVAL = 20;
const TITLE_REFRESH_DELAYS = [1200, 2600, 5000, 9000];

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

export default () => {
  const { currentUser, isLoggedIn } = useAppStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedConversationId = searchParams.get("conversationId");
  const [messageApi, messageContextHolder] = antdMessage.useMessage();

  // UI 状态
  const [theme, setTheme] = useState<"light" | "dark">(getStoredTheme);
  const [moduleExpanded, setModuleExpanded] = useState<boolean>(() =>
    getStoredBoolean("cw.module.expanded", true)
  );
  const [moduleDrawerVisible, setModuleDrawerVisible] = useState(false);
  const [conversationDrawerVisible, setConversationDrawerVisible] =
    useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const isDark = theme === "dark";

  // 对话状态
  const [conversations, setConversations] = useState<API.Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<API.Message[]>([]);
  const [models, setModels] = useState<API.Model[]>([]);
  const [mcpTools, setMcpTools] = useState<API.McpTool[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [defaultEndpointId, setDefaultEndpointId] = useState<number | null>(
    null
  );
  const [defaultEndpointProvider, setDefaultEndpointProvider] = useState<
    API.Endpoint["provider"] | undefined
  >(undefined);

  // 输入状态
  const [inputText, setInputText] = useState("");
  const [pendingImages, setPendingImages] = useState<
    { file: File; preview: string }[]
  >([]);

  // 生成参数（SOTA 级可控性）
  const [temperature, setTemperature] = useState<number>(() =>
    clamp(
      getStoredNumber(
        STORAGE_KEYS.temperature,
        0.7,
        STORAGE_KEYS.legacyTemperature
      ),
      0,
      2
    )
  );
  const [topP, setTopP] = useState<number>(() =>
    clamp(getStoredNumber(STORAGE_KEYS.topP, 1, STORAGE_KEYS.legacyTopP), 0, 1)
  );
  const [maxTokens, setMaxTokens] = useState<number>(() => {
    const stored = getStoredNumber(
      STORAGE_KEYS.maxTokens,
      -1,
      STORAGE_KEYS.legacyMaxTokens
    );
    if (stored === -1) return -1;
    return clamp(stored, 256, 8192);
  });

  // 流式处理状态
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 设置弹窗

  // System Prompt
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const currentConv = conversations.find((c) => c.id === currentConvId) ?? null;
  const currentSystemPrompt = currentConv?.system_prompt ?? "";

  // 模型对比
  const [showCompare, setShowCompare] = useState(false);

  // 对话重命名状态
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // 消息编辑状态
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [editingMsgContent, setEditingMsgContent] = useState("");

  // 会话搜索状态
  const [searchQuery, setSearchQuery] = useState("");
  const [savingConversationTools, setSavingConversationTools] = useState(false);

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

  // 响应式监听
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // 主题持久化
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("cw.module.expanded", String(moduleExpanded));
  }, [moduleExpanded]);

  // 生成参数持久化
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.temperature, String(temperature));
    localStorage.setItem(STORAGE_KEYS.topP, String(topP));
    localStorage.setItem(STORAGE_KEYS.maxTokens, String(maxTokens));
  }, [temperature, topP, maxTokens]);

  useEffect(() => {
    const storageKey = getModelStorageKey(defaultEndpointId);
    const legacyStorageKey = getLegacyModelStorageKey(defaultEndpointId);
    if (!storageKey) return;

    if (selectedModel) {
      localStorage.setItem(storageKey, selectedModel);
      if (legacyStorageKey) {
        localStorage.removeItem(legacyStorageKey);
      }
    } else {
      localStorage.removeItem(storageKey);
      if (legacyStorageKey) {
        localStorage.removeItem(legacyStorageKey);
      }
    }
  }, [defaultEndpointId, selectedModel]);

  useEffect(() => {
    currentConvIdRef.current = currentConvId;
  }, [currentConvId]);

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
      setSearchQuery("");
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
      const [convs, availableModels, endpoints, availableMcpTools] =
        await Promise.all([
          getConversations(),
          getAvailableModels(),
          getEndpoints(),
          getMcpTools(),
        ]);
      const defaultEndpoint =
        endpoints.find((endpoint) => !!endpoint.is_default) || null;
      const nextDefaultEndpointId = defaultEndpoint?.id ?? null;
      const storedModel = getStoredString(
        getModelStorageKey(nextDefaultEndpointId),
        getLegacyModelStorageKey(nextDefaultEndpointId)
      );

      setConversations(convs);
      setModels(availableModels);
      setMcpTools(Array.isArray(availableMcpTools) ? availableMcpTools : []);
      setDefaultEndpointId(nextDefaultEndpointId);
      setDefaultEndpointProvider(defaultEndpoint?.provider);
      setSelectedModel((prev) => {
        if (
          storedModel &&
          availableModels.some((m) => m.model_id === storedModel)
        ) {
          return storedModel;
        }
        if (prev && availableModels.some((m) => m.model_id === prev)) {
          return prev;
        }
        return availableModels[0]?.model_id || "";
      });
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

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: loading ? "auto" : "smooth",
      block: "end",
    });
  }, [loading]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

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
      if (streamSegmentQueueRef.current.length === 0) {
        streamSegmentDrainTimerRef.current = null;
        return;
      }

      const piece = streamSegmentQueueRef.current.shift();
      if (piece) {
        streamBufferRef.current += piece;
        scheduleStreamFlush();
      }
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
        if (segments.length <= 1) {
          streamBufferRef.current += segments[0] || content;
          scheduleStreamFlush();
        } else {
          streamSegmentQueueRef.current.push(...segments);
          scheduleSegmentDrain();
        }
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
      scheduleStreamFlush,
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
      const newConv = await createConversation("新对话");
      setConversations((prev) => [newConv, ...prev]);
      setCurrentConvId(newConv.id);
      setMessages([]);
      if (isMobile) setConversationDrawerVisible(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (error) {
      console.error(error);
    }
  };

  const handleSelectConversation = async (id: string) => {
    setCurrentConvId(id);
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
      const newConvs = conversations.filter((c) => c.id !== id);
      setConversations(newConvs);
      if (currentConvId === id) {
        if (newConvs.length > 0) {
          handleSelectConversation(newConvs[0].id);
        } else {
          setCurrentConvId(null);
          setMessages([]);
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

  const handleSaveSystemPrompt = async (prompt: string) => {
    if (!currentConvId) return;
    try {
      await updateConversation(currentConvId, undefined as any, prompt);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === currentConvId ? { ...c, system_prompt: prompt } : c
        )
      );
      messageApi.success("System Prompt 已保存");
    } catch (e) {
      messageApi.error("保存失败");
    }
  };

  const availableToolMap = new Map<string, API.McpTool>();
  (Array.isArray(mcpTools) ? mcpTools : []).forEach((tool) => {
    const toolName = String(tool?.function?.name || "").trim();
    if (toolName && !availableToolMap.has(toolName)) {
      availableToolMap.set(toolName, tool);
    }
  });

  const availableToolNames = Array.from(availableToolMap.keys()).sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );

  const conversationUsesAllTools = currentConv?.tool_names == null;
  const selectedConversationToolNames = Array.isArray(currentConv?.tool_names)
    ? currentConv.tool_names.filter((toolName) =>
        availableToolMap.has(toolName)
      )
    : [];

  const toolSelectOptions = availableToolNames.map((toolName) => {
    const tool = availableToolMap.get(toolName);
    return {
      value: toolName,
      searchText: `${toolName} ${
        tool?.function?.description || ""
      }`.toLowerCase(),
      label: (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span>{toolName}</span>
          {tool?.function?.description ? (
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
              {tool.function.description}
            </span>
          ) : null}
        </div>
      ),
    };
  });

  const conversationToolButtonText = !currentConv
    ? "工具"
    : conversationUsesAllTools
    ? availableToolNames.length > 0
      ? `全部工具 (${availableToolNames.length})`
      : "工具"
    : selectedConversationToolNames.length > 0
    ? `已选工具 (${selectedConversationToolNames.length})`
    : "工具已关闭";

  const persistConversationTools = async (toolNames: string[] | null) => {
    if (!currentConvId) return;

    try {
      setSavingConversationTools(true);
      await updateConversation(currentConvId, undefined, undefined, toolNames);
      setConversations((prev) =>
        prev.map((conversation) =>
          String(conversation.id) === String(currentConvId)
            ? { ...conversation, tool_names: toolNames }
            : conversation
        )
      );
      messageApi.success(
        toolNames === null
          ? "当前会话已恢复为全部已启用工具"
          : toolNames.length > 0
          ? `当前会话已限制为 ${toolNames.length} 个工具`
          : "当前会话已禁用所有工具"
      );
    } catch (error) {
      console.error(error);
      messageApi.error("保存会话工具设置失败");
    } finally {
      setSavingConversationTools(false);
    }
  };

  const handleConversationToolModeChange = async (checked: boolean) => {
    if (checked) {
      await persistConversationTools(null);
      return;
    }

    const nextToolNames =
      selectedConversationToolNames.length > 0
        ? selectedConversationToolNames
        : availableToolNames;
    await persistConversationTools(nextToolNames);
  };

  const generationConfig: Record<string, number> = {
    temperature: Number(clamp(temperature, 0, 2).toFixed(2)),
    top_p: Number(clamp(topP, 0, 1).toFixed(2)),
  };
  if (maxTokens !== -1) {
    generationConfig.max_tokens = clamp(Math.round(maxTokens), 256, 8192);
  }

  const autoMaxTokensLabel =
    defaultEndpointProvider === "openrouter"
      ? "自动（OpenRouter 默认 16384）"
      : "自动（不传）";

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

      let body: any = { model: selectedModel, ...generationConfig };
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
    if (!selectedModel) {
      messageApi.error("请先选择模型");
      return;
    }

    let convId = currentConvId;
    const shouldSummarizeTitle = messages.length === 0;
    if (!convId) {
      const newConv = await createConversation("新对话");
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
    if (!selectedModel) {
      messageApi.error("请先选择模型");
      return;
    }
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
    if (!selectedModel) {
      messageApi.error("请先选择模型");
      return;
    }

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
          model: selectedModel,
          ...generationConfig,
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
    abortControllerRef.current?.abort();
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

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const visibleMessages = messages.filter(
    (msg) =>
      !(
        msg.role === "assistant" &&
        !msg.content &&
        Array.isArray(msg.tool_calls) &&
        msg.tool_calls.length > 0
      )
  );
  const modelOptions = models.map((model) => ({
    label: model.model_id,
    value: model.model_id,
    searchText: `${model.model_id} ${model.display_name}`.toLowerCase(),
  }));

  const moduleNavContent = (
    <Sidebar
      moduleExpanded={moduleExpanded}
      setModuleExpanded={setModuleExpanded}
      theme={theme}
      setTheme={setTheme}
      activePath="/chat"
    />
  );

  const conversationListContent = (
    <div className={`conversation-panel ${isDark ? "dark" : ""}`}>
      <div className="conversation-panel-header">
        <div className="conversation-panel-title">
          <AppstoreOutlined />
          <span>对话列表</span>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          size="small"
          onClick={handleCreateChat}
          title={"新对话 (Ctrl+N)"}
        >
          新建
        </Button>
      </div>

      <Input.Search
        placeholder="搜索对话..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        allowClear
        size="small"
        className="conversation-search"
      />

      <div className="conversation-scroll">
        {filteredConversations.map((conv) => (
          <div
            key={conv.id}
            className={`conversation-item ${
              currentConvId === conv.id ? "active" : ""
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
        {conversations.length === 0 && (
          <div className="empty-conv">暂无对话记录</div>
        )}
      </div>
    </div>
  );

  const lastAssistantIdx = [...visibleMessages]
    .map((m) => m.role)
    .lastIndexOf("assistant");

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
        {!isMobile && moduleNavContent}

        {isMobile && (
          <>
            <Drawer
              placement="left"
              open={moduleDrawerVisible}
              onClose={() => setModuleDrawerVisible(false)}
              width={220}
              styles={{ body: { padding: 0 } }}
              title={null}
            >
              {moduleNavContent}
            </Drawer>
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
          </>
        )}

        <main className="chat-content" style={{ flex: 1, minWidth: 0 }}>
          <div className="chat-header">
            <div className="header-left">
              {isMobile && (
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  onClick={() => setModuleDrawerVisible(true)}
                />
              )}
              <span className="header-title">CW · 对话</span>
              {currentConvId && (
                <Tooltip
                  title={
                    currentSystemPrompt
                      ? "编辑 System Prompt（已激活）"
                      : "设置 System Prompt"
                  }
                >
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => setShowSystemPrompt(true)}
                    style={{
                      color: currentSystemPrompt ? "#f59e0b" : undefined,
                      fontWeight: currentSystemPrompt ? 600 : undefined,
                    }}
                  >
                    {currentSystemPrompt ? "System Prompt ✦" : "System Prompt"}
                  </Button>
                </Tooltip>
              )}
              {currentConvId && (
                <Popover
                  trigger="click"
                  placement="bottomLeft"
                  content={
                    <div className="conversation-tool-config">
                      <div className="conversation-tool-config-head">
                        <div className="conversation-tool-config-title">
                          对话工具
                        </div>
                        <Switch
                          size="small"
                          checked={conversationUsesAllTools}
                          checkedChildren="全部"
                          unCheckedChildren="自定义"
                          loading={savingConversationTools}
                          onChange={handleConversationToolModeChange}
                        />
                      </div>
                      <div className="conversation-tool-config-hint">
                        开启“全部”时，当前会话可使用所有已启用 MCP
                        工具；关闭后只开放下面勾选的工具。
                      </div>
                      <Select
                        mode="multiple"
                        allowClear
                        value={selectedConversationToolNames}
                        onChange={(values) => persistConversationTools(values)}
                        options={toolSelectOptions}
                        disabled={
                          conversationUsesAllTools ||
                          savingConversationTools ||
                          toolSelectOptions.length === 0
                        }
                        placeholder={
                          toolSelectOptions.length === 0
                            ? "暂无可用 MCP 工具"
                            : "选择本会话允许调用的工具"
                        }
                        className="conversation-tool-select"
                        popupMatchSelectWidth={360}
                        showSearch
                        filterOption={(input, option) =>
                          String(option?.searchText || "").includes(
                            input.trim().toLowerCase()
                          )
                        }
                      />
                      {!conversationUsesAllTools &&
                      selectedConversationToolNames.length === 0 ? (
                        <div className="conversation-tool-config-warning">
                          当前会话已禁用所有工具，模型将只做纯文本回答。
                        </div>
                      ) : null}
                    </div>
                  }
                >
                  <Tooltip title="设置当前对话可用工具">
                    <Button
                      type="text"
                      size="small"
                      icon={<ToolOutlined />}
                      loading={savingConversationTools}
                      style={{
                        color: !conversationUsesAllTools
                          ? "#0f766e"
                          : undefined,
                        fontWeight: !conversationUsesAllTools ? 600 : undefined,
                      }}
                    >
                      {conversationToolButtonText}
                    </Button>
                  </Tooltip>
                </Popover>
              )}
            </div>
            <div className="header-right">
              {isMobile && (
                <Tooltip title="对话列表">
                  <Button
                    type="text"
                    icon={<AppstoreOutlined />}
                    onClick={() => setConversationDrawerVisible(true)}
                  />
                </Tooltip>
              )}
              {models.length >= 2 && (
                <Tooltip title="多模型并行对比">
                  <Button
                    type="text"
                    size="small"
                    icon={<ThunderboltOutlined />}
                    onClick={() => setShowCompare(true)}
                    style={{ color: "#f59e0b" }}
                  >
                    对比
                  </Button>
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

          <div className="chat-main">
            <div className="chat-center">
              <div className="messages-area">
                {messages.length === 0 ? (
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
                      <div className={`message-bubble ${msg.role}`}>
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
                          <div
                            className={`tool-message-card ${getToolMessageStatus(
                              msg
                            )}`}
                          >
                            <div className="tool-message-header">
                              <span className="tool-message-name">
                                {getToolMessageName(msg)}
                              </span>
                              <span className="tool-message-status">
                                {getToolMessageStatus(msg) === "running"
                                  ? "运行中"
                                  : getToolMessageStatus(msg) === "error"
                                  ? "失败"
                                  : "完成"}
                              </span>
                            </div>
                            <pre className="tool-message-body">
                              {extractDisplayContent(msg.content)}
                            </pre>
                          </div>
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

                  <div className="model-picker">
                    <Select
                      value={selectedModel || undefined}
                      onChange={setSelectedModel}
                      options={modelOptions}
                      showSearch
                      filterOption={(input, option) =>
                        String(option?.searchText || "").includes(
                          input.trim().toLowerCase()
                        )
                      }
                      popupMatchSelectWidth={460}
                      variant="borderless"
                      className="model-select"
                      disabled={loading}
                      placeholder="搜索或选择模型"
                      notFoundContent="暂无可用模型"
                    />
                  </div>

                  <Popover
                    trigger="click"
                    placement="topRight"
                    content={
                      <div className="generation-config">
                        <div className="generation-item">
                          <div className="generation-label">
                            Temperature: {temperature.toFixed(2)}
                          </div>
                          <Slider
                            min={0}
                            max={2}
                            step={0.01}
                            value={temperature}
                            onChange={setTemperature}
                          />
                        </div>
                        <div className="generation-item">
                          <div className="generation-label">
                            Top P: {topP.toFixed(2)}
                          </div>
                          <Slider
                            min={0}
                            max={1}
                            step={0.01}
                            value={topP}
                            onChange={setTopP}
                          />
                        </div>
                        <div className="generation-item">
                          <div
                            className="generation-label"
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <span>
                              Max Tokens:{" "}
                              {maxTokens === -1
                                ? autoMaxTokensLabel
                                : Math.round(maxTokens)}
                            </span>
                            <Button
                              type="link"
                              size="small"
                              style={{ padding: 0, height: "auto" }}
                              onClick={() =>
                                setMaxTokens((prev) =>
                                  prev === -1 ? 2048 : -1
                                )
                              }
                            >
                              {maxTokens === -1 ? "改为固定值" : "自动(-1)"}
                            </Button>
                          </div>
                          <Slider
                            min={256}
                            max={8192}
                            step={64}
                            value={maxTokens === -1 ? 2048 : maxTokens}
                            onChange={setMaxTokens}
                            disabled={maxTokens === -1}
                          />
                        </div>
                      </div>
                    }
                  >
                    <Tooltip title="高级参数">
                      <Button
                        type="text"
                        icon={<SlidersOutlined />}
                        className="input-action-btn"
                        disabled={loading}
                      />
                    </Tooltip>
                  </Popover>

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
                      disabled={
                        (!inputText.trim() && pendingImages.length === 0) ||
                        !selectedModel
                      }
                      onClick={sendMessage}
                      className="send-btn"
                    />
                  )}
                </div>
                <div className="input-hint">
                  CW 是一款 AI 工具，其回答未必正确无误。Shift+Enter 换行
                </div>
              </div>
            </div>

            {!isMobile && conversationListContent}
          </div>
        </main>

        <SystemPromptModal
          open={showSystemPrompt}
          onClose={() => setShowSystemPrompt(false)}
          conversationId={currentConvId}
          currentPrompt={currentSystemPrompt}
          onSave={handleSaveSystemPrompt}
        />
        <ModelCompareModal
          open={showCompare}
          onClose={() => setShowCompare(false)}
          models={models}
          conversationId={currentConvId}
          isDark={isDark}
        />
      </div>
    </ConfigProvider>
  );
};
