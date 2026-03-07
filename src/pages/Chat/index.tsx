import { AccountModal } from "@/components/AccountModal";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { ModelCompareModal } from "@/components/ModelCompareModal";
import { SettingsModal } from "@/components/SettingsModal";
import { SystemPromptModal } from "@/components/SystemPromptModal";
import {
  createConversation,
  deleteConversation,
  getAvailableModels,
  getConversations,
  getEndpoints,
  getMessages,
  summarizeConversationTitle,
  updateConversation,
} from "@/services/api";
import {
  BarChartOutlined,
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  LogoutOutlined,
  MenuOutlined,
  MoonOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  SettingOutlined,
  SlidersOutlined,
  StopOutlined,
  SunOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { history, useIntl, useModel } from "@umijs/max";
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
  Tooltip,
  Upload,
  message as antdMessage,
  theme as antdTheme,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import "./index.css";

const { Sider, Content } = Layout;
const { TextArea } = Input;

// 从 localStorage 获取/保存主题
const getStoredTheme = (): "light" | "dark" => {
  const saved = localStorage.getItem("timo-theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const getStoredNumber = (key: string, fallback: number): number => {
  const stored = Number(localStorage.getItem(key));
  return Number.isFinite(stored) ? stored : fallback;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getStoredString = (key: string): string => {
  return localStorage.getItem(key) || "";
};

const getModelStorageKey = (endpointId: number | null) =>
  endpointId ? `timo.selected_model.${endpointId}` : "";

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

const STREAM_FLUSH_INTERVAL = 48;

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
  const { currentUser, logout, isLoggedIn } = useModel("global");
  const intl = useIntl();

  // UI 状态
  const [theme, setTheme] = useState<"light" | "dark">(getStoredTheme);
  const [siderVisible, setSiderVisible] = useState(false); // mobile drawer
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const isDark = theme === "dark";

  // 对话状态
  const [conversations, setConversations] = useState<API.Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<API.Message[]>([]);
  const [models, setModels] = useState<API.Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [defaultEndpointId, setDefaultEndpointId] = useState<number | null>(
    null
  );

  // 输入状态
  const [inputText, setInputText] = useState("");
  const [pendingImages, setPendingImages] = useState<
    { file: File; preview: string }[]
  >([]);

  // 生成参数（SOTA 级可控性）
  const [temperature, setTemperature] = useState<number>(() =>
    clamp(getStoredNumber("timo.temperature", 0.7), 0, 2)
  );
  const [topP, setTopP] = useState<number>(() =>
    clamp(getStoredNumber("timo.top_p", 1), 0, 1)
  );
  const [maxTokens, setMaxTokens] = useState<number>(() => {
    const stored = getStoredNumber("timo.max_tokens", -1);
    if (stored === -1) return -1;
    return clamp(stored, 256, 8192);
  });

  // 流式处理状态
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 设置弹窗
  const [showSettings, setShowSettings] = useState(false);

  // System Prompt
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const currentConv = conversations.find((c) => c.id === currentConvId) ?? null;
  const currentSystemPrompt = currentConv?.system_prompt ?? "";

  // 模型对比
  const [showCompare, setShowCompare] = useState(false);

  // 用量统计 / API Keys
  const [showAccount, setShowAccount] = useState(false);

  // 对话重命名状态
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  // 消息编辑状态
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [editingMsgContent, setEditingMsgContent] = useState("");

  // 会话搜索状态
  const [searchQuery, setSearchQuery] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamBufferRef = useRef("");
  const streamErrorRef = useRef<string | null>(null);
  const streamTargetIndexRef = useRef<number | null>(null);
  const streamFlushTimerRef = useRef<number | null>(null);
  const sseRemainderRef = useRef("");
  const [streamRenderTick, setStreamRenderTick] = useState(0);

  // 响应式监听
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // 主题持久化
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("timo-theme", theme);
  }, [theme]);

  // 生成参数持久化
  useEffect(() => {
    localStorage.setItem("timo.temperature", String(temperature));
    localStorage.setItem("timo.top_p", String(topP));
    localStorage.setItem("timo.max_tokens", String(maxTokens));
  }, [temperature, topP, maxTokens]);

  useEffect(() => {
    const storageKey = getModelStorageKey(defaultEndpointId);
    if (!storageKey) return;

    if (selectedModel) {
      localStorage.setItem(storageKey, selectedModel);
    } else {
      localStorage.removeItem(storageKey);
    }
  }, [defaultEndpointId, selectedModel]);

  // 登录检查 & 初始化
  useEffect(() => {
    if (!isLoggedIn) {
      history.push("/login");
      return;
    }
    loadInitData();
  }, [isLoggedIn]);

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
      const [convs, availableModels, endpoints] = await Promise.all([
        getConversations(),
        getAvailableModels(),
        getEndpoints(),
      ]);
      const defaultEndpoint =
        endpoints.find((endpoint) => !!endpoint.is_default) || null;
      const nextDefaultEndpointId = defaultEndpoint?.id ?? null;
      const storedModel = getStoredString(
        getModelStorageKey(nextDefaultEndpointId)
      );

      setConversations(convs);
      setModels(availableModels);
      setDefaultEndpointId(nextDefaultEndpointId);
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
      if (convs.length > 0) handleSelectConversation(convs[0].id);
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
    };
  }, []);

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

    setStreamRenderTick((tick) => tick + 1);
  }, []);

  const scheduleStreamFlush = useCallback(() => {
    if (streamFlushTimerRef.current !== null) return;
    streamFlushTimerRef.current = window.setTimeout(() => {
      flushStreamBuffer();
    }, STREAM_FLUSH_INTERVAL);
  }, [flushStreamBuffer]);

  const appendAssistantChunk = useCallback(
    (content?: string, error?: string) => {
      if (content) {
        streamBufferRef.current += content;
      }
      if (error) {
        streamErrorRef.current = error;
      }
      scheduleStreamFlush();
    },
    [scheduleStreamFlush]
  );

  const createAssistantPlaceholder = useCallback(async () => {
    streamBufferRef.current = "";
    streamErrorRef.current = null;
    sseRemainderRef.current = "";

    await new Promise<void>((resolve) => {
      setMessages((prev) => {
        const nextIndex = prev.length;
        streamTargetIndexRef.current = nextIndex;
        resolve();
        return [...prev, { role: "assistant", content: "" }];
      });
    });
  }, []);

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
      setStreamRenderTick((tick) => tick + 1);
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

  const handleCreateChat = async () => {
    try {
      const newConv = await createConversation("新对话");
      setConversations((prev) => [newConv, ...prev]);
      setCurrentConvId(newConv.id);
      setMessages([]);
      if (isMobile) setSiderVisible(false);
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
    if (isMobile) setSiderVisible(false);
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
      antdMessage.success("System Prompt 已保存");
    } catch (e) {
      antdMessage.error("保存失败");
    }
  };

  const generationConfig: Record<string, number> = {
    temperature: Number(clamp(temperature, 0, 2).toFixed(2)),
    top_p: Number(clamp(topP, 0, 1).toFixed(2)),
  };
  if (maxTokens !== -1) {
    generationConfig.max_tokens = clamp(Math.round(maxTokens), 256, 8192);
  }

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
      const token = localStorage.getItem("token");
      const url = isRegenerate
        ? `/api/conversations/${convId}/regenerate`
        : `/api/conversations/${convId}/chat`;

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
          Authorization: `Bearer ${token}`,
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
        antdMessage.error(error.message || "发送失败，请检查网络和 API 配置");
        console.error(error);
      }
    } finally {
      flushStreamBuffer();
      setLoading(false);
      abortControllerRef.current = null;
      streamTargetIndexRef.current = null;
      sseRemainderRef.current = "";
    }
  };

  const sendMessage = async () => {
    if ((!inputText.trim() && pendingImages.length === 0) || loading) return;
    if (!selectedModel) {
      antdMessage.error("请先选择模型");
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
    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setPendingImages([]);

    await streamChat(convId, userMsg, false);

    if (shouldSummarizeTitle) {
      summarizeConversationTitle(convId, selectedModel).catch((e) =>
        console.error(e)
      );
      // 异步总结会有延迟，稍后刷新会话列表拿到新标题
      setTimeout(() => refreshConversations(), 2000);
    }
  };

  const handleRegenerate = async () => {
    if (!currentConvId || loading) return;
    if (!selectedModel) {
      antdMessage.error("请先选择模型");
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
      antdMessage.error("请先选择模型");
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
      const token = localStorage.getItem("token");
      const url = `/api/conversations/${currentConvId}/messages/${msgId}`;

      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
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
        antdMessage.error(error.message || "发送失败，请检查网络和 API 配置");
        console.error(error);
      }
    } finally {
      flushStreamBuffer();
      setLoading(false);
      abortControllerRef.current = null;
      streamTargetIndexRef.current = null;
      sseRemainderRef.current = "";
      refreshConversations();
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const handleCopyMessage = (content: string) => {
    const displayContent = extractDisplayContent(content);
    navigator.clipboard.writeText(displayContent);
    antdMessage.success("已复制到剪贴板");
  };

  const handleImageAdd = (file: File) => {
    const preview = URL.createObjectURL(file);
    setPendingImages((prev) => [...prev, { file, preview }]);
    return false; // 阻止 antd Upload 自动上传
  };

  const handleImageRemove = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const modelOptions = models.map((model) => ({
    label: model.model_id,
    value: model.model_id,
    searchText: `${model.model_id} ${model.display_name}`.toLowerCase(),
  }));

  // Sidebar 内容
  const siderContent = (
    <div className={`sider-inner ${isDark ? "dark" : ""}`}>
      <div className="sider-top">
        <Button
          type="text"
          icon={<PlusOutlined />}
          onClick={handleCreateChat}
          className="new-chat-btn"
          title={intl.formatMessage({ id: "chat.new_chat" }) + " (Ctrl+N)"}
        >
          {intl.formatMessage({ id: "chat.new_chat" })}
        </Button>

        <div className="conv-list">
          <div className="conv-list-header" style={{ padding: "0 8px 12px" }}>
            <Input.Search
              placeholder="搜索对话..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              allowClear
              size="small"
            />
          </div>
          {filteredConversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${
                currentConvId === conv.id ? "active" : ""
              }`}
              onClick={() => handleSelectConversation(conv.id)}
            >
              {editingTitleId === conv.id ? (
                <div
                  className="title-edit"
                  onClick={(e) => e.stopPropagation()}
                >
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

      <div className="sider-bottom">
        <Button
          block
          icon={isDark ? <SunOutlined /> : <MoonOutlined />}
          onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          className="sider-action-btn"
        >
          {isDark ? "浅色模式" : "深色模式"}
        </Button>
        <Button
          block
          icon={<BarChartOutlined />}
          onClick={() => setShowAccount(true)}
          className="sider-action-btn"
        >
          {intl.formatMessage({ id: "account.title" }).split(" ")[0]}{" "}
          {/* 简写 */}
        </Button>
        <Button
          block
          icon={<SettingOutlined />}
          onClick={() => setShowSettings(true)}
          className="sider-action-btn"
        >
          {intl.formatMessage({ id: "chat.settings" })}
        </Button>
        <Button
          block
          icon={<LogoutOutlined />}
          onClick={logout}
          className="sider-action-btn"
          danger
        >
          退出登录
        </Button>
      </div>
    </div>
  );

  const lastAssistantIdx = [...messages]
    .map((m) => m.role)
    .lastIndexOf("assistant");

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm,
      }}
    >
      <Layout className={`chat-layout ${isDark ? "dark" : ""}`}>
        {/* Desktop Sider */}
        {!isMobile && (
          <Sider width={260} className="chat-sider">
            {siderContent}
          </Sider>
        )}

        {/* Mobile Drawer */}
        {isMobile && (
          <Drawer
            placement="left"
            open={siderVisible}
            onClose={() => setSiderVisible(false)}
            width={260}
            styles={{ body: { padding: 0 } }}
            title={null}
          >
            {siderContent}
          </Drawer>
        )}

        <Layout>
          <Content className="chat-content">
            {/* Header */}
            <div className="chat-header">
              <div className="header-left">
                {isMobile && (
                  <Button
                    type="text"
                    icon={<MenuOutlined />}
                    onClick={() => setSiderVisible(true)}
                  />
                )}
                <span className="header-title">Gemini Chat</span>
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
                      {currentSystemPrompt
                        ? "System Prompt ✦"
                        : "System Prompt"}
                    </Button>
                  </Tooltip>
                )}
              </div>
              <div className="header-right">
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

            {/* Messages */}
            <div className="messages-area">
              {messages.length === 0 ? (
                <div className="empty-messages">
                  <div className="empty-icon">✨</div>
                  <div className="empty-title">有什么我可以帮你的？</div>
                  <div className="empty-hint">按 Ctrl+N 创建新对话</div>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={idx} className={`message-row ${msg.role}`}>
                    {msg.role === "assistant" && (
                      <Avatar className="msg-avatar assistant-avatar" size={32}>
                        AI
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
                              key={
                                loading && idx === lastAssistantIdx
                                  ? `stream-${streamRenderTick}`
                                  : `static-${idx}`
                              }
                              className="stream-fade-shell"
                              data-streaming={
                                loading && idx === lastAssistantIdx
                              }
                            >
                              <MarkdownRenderer
                                content={msg.content}
                                isDark={isDark}
                              />
                            </div>
                          ) : (
                            <div className="typing-placeholder">
                              <span>AI 正在思考</span>
                              <span className="typing-dots">
                                <i />
                                <i />
                                <i />
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Message Actions */}
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

            {/* Input Area */}
            <div className="input-area">
              {/* Pending Images Preview */}
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
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="问问 Timo… (Shift+Enter 换行 / Enter 发送)"
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  bordered={false}
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
                    bordered={false}
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
                              ? "自动（不传）"
                              : Math.round(maxTokens)}
                          </span>
                          <Button
                            type="link"
                            size="small"
                            style={{ padding: 0, height: "auto" }}
                            onClick={() =>
                              setMaxTokens((prev) => (prev === -1 ? 2048 : -1))
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
                Timo 是一款 AI 工具，其回答未必正确无误。Shift+Enter 换行
              </div>
            </div>
          </Content>
        </Layout>

        <SettingsModal
          open={showSettings}
          onOpenChange={(v) => {
            setShowSettings(v);
            if (!v) loadInitData();
          }}
        />
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
        <AccountModal
          open={showAccount}
          onClose={() => setShowAccount(false)}
          isDark={isDark}
        />
      </Layout>
    </ConfigProvider>
  );
};
