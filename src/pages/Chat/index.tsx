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
  Popover,
  Slider,
  Popconfirm,
  Select,
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

  // 输入状态
  const [inputText, setInputText] = useState("");
  const [pendingImages, setPendingImages] = useState<
    { file: File; preview: string }[]
  >([]);

  // 生成参数（SOTA 级可控性）
  const [temperature, setTemperature] = useState<number>(() =>
    getStoredNumber("timo.temperature", 0.7)
  );
  const [topP, setTopP] = useState<number>(() =>
    getStoredNumber("timo.top_p", 1)
  );
  const [maxTokens, setMaxTokens] = useState<number>(() =>
    getStoredNumber("timo.max_tokens", 2048)
  );

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
      const [convs, availableModels] = await Promise.all([
        getConversations(),
        getAvailableModels(),
      ]);
      setConversations(convs);
      setModels(availableModels);
      if (availableModels.length > 0)
        setSelectedModel(availableModels[0].model_id);
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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

  const generationConfig = {
    temperature: Number(temperature.toFixed(2)),
    top_p: Number(topP.toFixed(2)),
    max_tokens: Math.max(1, Math.round(maxTokens)),
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

    try {
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

      if (!response.ok) throw new Error("Network response was not ok");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      // 添加空 assistant 消息占位
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk
          .split("\n")
          .filter((line) => line.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "tool_running") {
              setMessages((prev) => [
                ...prev,
                { role: "tool", content: `🔧 正在执行工具：${parsed.tool_name}...` },
                { role: "assistant", content: "" }
              ]);
            } else {
              setMessages((prev) => {
                const newMessages = [...prev];
                const lastMsg = newMessages[newMessages.length - 1];
                if (lastMsg.role === "assistant") {
                  if (parsed.content) lastMsg.content += parsed.content;
                  if (parsed.error) lastMsg.content = `❌ 错误：${parsed.error}`;
                }
                return newMessages;
              });
            }
            if (parsed.title) {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === convId ? { ...c, title: parsed.title } : c
                )
              );
            }
          } catch (e) {
            // ignore parse errors
          }
        }
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        antdMessage.error("发送失败，请检查网络和 API 配置");
        console.error(error);
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const sendMessage = async () => {
    if ((!inputText.trim() && pendingImages.length === 0) || loading) return;

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

    // 截断界面消息并替换编辑的消息
    const msgIndex = messages.findIndex((m) => m.id === msgId);
    if (msgIndex !== -1) {
      const updatedMessages = messages.slice(0, msgIndex);
      const editedMsg = { ...messages[msgIndex], content };
      updatedMessages.push(editedMsg);
      // 添加空 assistant 消息占位
      updatedMessages.push({ role: "assistant", content: "" });
      setMessages(updatedMessages);
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
        body: JSON.stringify({ content, model: selectedModel, ...generationConfig }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error("Network response was not ok");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk
          .split("\n")
          .filter((line) => line.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "tool_running") {
              setMessages((prev) => [
                ...prev,
                { role: "tool", content: `🔧 正在执行工具：${parsed.tool_name}...` },
                { role: "assistant", content: "" }
              ]);
            } else {
              setMessages((prev) => {
                const newMessages = [...prev];
                const lastMsg = newMessages[newMessages.length - 1];
                if (lastMsg.role === "assistant") {
                  if (parsed.content) lastMsg.content += parsed.content;
                  if (parsed.error) lastMsg.content = `❌ 错误：${parsed.error}`;
                }
                return newMessages;
              });
            }
            if (parsed.title) {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === currentConvId ? { ...c, title: parsed.title } : c
                )
              );
            }
          } catch (e) {
            // ignore parse errors
          }
        }
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        antdMessage.error("发送失败，请检查网络和 API 配置");
        console.error(error);
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
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

  const filteredConversations = conversations.filter(c =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
          <div className="conv-list-header" style={{ padding: '0 8px 12px' }}>
            <Input.Search
              placeholder="搜索对话..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              allowClear
              size="small"
            />
          </div>
          {filteredConversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${currentConvId === conv.id ? "active" : ""
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
                <span className="header-title">Timo</span>
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
                                onChange={(e) => setEditingMsgContent(e.target.value)}
                                className="edit-message-input"
                                disabled={loading}
                              />
                              <div className="edit-message-actions" style={{ marginTop: 8, textAlign: 'right' }}>
                                <Button size="small" onClick={() => setEditingMsgId(null)} disabled={loading} style={{ marginRight: 8 }}>
                                  取消
                                </Button>
                                <Button size="small" type="primary" onClick={() => handleSaveEdit(msg.id!)} loading={loading}>
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
                            <MarkdownRenderer
                              content={msg.content}
                              isDark={isDark}
                            />
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
                          {loading && idx === lastAssistantIdx && (
                            <span className="stream-cursor" />
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
                              setEditingMsgContent(extractDisplayContent(msg.content));
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

                <Select
                  value={selectedModel}
                  onChange={setSelectedModel}
                  options={models.map((m) => ({
                    label: m.display_name,
                    value: m.model_id,
                  }))}
                  bordered={false}
                  style={{ minWidth: 120, maxWidth: 180 }}
                  disabled={loading}
                  placeholder="选择模型"
                />

                <Popover
                  trigger="click"
                  placement="topRight"
                  content={
                    <div className="generation-config">
                      <div className="generation-item">
                        <div className="generation-label">Temperature: {temperature.toFixed(2)}</div>
                        <Slider min={0} max={2} step={0.01} value={temperature} onChange={setTemperature} />
                      </div>
                      <div className="generation-item">
                        <div className="generation-label">Top P: {topP.toFixed(2)}</div>
                        <Slider min={0} max={1} step={0.01} value={topP} onChange={setTopP} />
                      </div>
                      <div className="generation-item">
                        <div className="generation-label">Max Tokens: {Math.round(maxTokens)}</div>
                        <Slider min={256} max={8192} step={64} value={maxTokens} onChange={setMaxTokens} />
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
                    disabled={!inputText.trim() && pendingImages.length === 0}
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

        <SettingsModal open={showSettings} onOpenChange={setShowSettings} />
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
