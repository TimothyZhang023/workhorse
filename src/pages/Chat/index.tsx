import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Layout, Button, Input, Select, Avatar, Popconfirm,
  message as antdMessage, Drawer, Upload, Tooltip, ConfigProvider, theme as antdTheme,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SettingOutlined, LogoutOutlined,
  UserOutlined, SendOutlined, StopOutlined, ReloadOutlined,
  CopyOutlined, SunOutlined, MoonOutlined, MenuOutlined,
  PictureOutlined, EditOutlined, CheckOutlined, CloseOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useModel, history } from '@umijs/max';
import { SettingsModal } from '@/components/SettingsModal';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { SystemPromptModal } from '@/components/SystemPromptModal';
import { ModelCompareModal } from '@/components/ModelCompareModal';
import {
  getConversations,
  createConversation,
  deleteConversation,
  getMessages,
  getAvailableModels,
  updateConversation,
} from '@/services/api';
import './index.css';

const { Sider, Content } = Layout;

// 从 localStorage 获取/保存主题
const getStoredTheme = (): 'light' | 'dark' => {
  const saved = localStorage.getItem('timo-theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

// 将图片文件转为 base64
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // 只保留 base64 数据部分
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
  });

// 从存储内容中提取显示文本（去掉图片数据）
const extractDisplayContent = (content: string): string => {
  return content.replace(/\[IMAGE_DATA:[^\]]+\]/g, '[📷 图片]');
};

// 检查消息是否包含图片
const hasImage = (content: string): boolean => content.includes('[IMAGE_DATA:');

export default () => {
  const { currentUser, logout, isLoggedIn } = useModel('global');

  // UI 状态
  const [theme, setTheme] = useState<'light' | 'dark'>(getStoredTheme);
  const [siderVisible, setSiderVisible] = useState(false); // mobile drawer
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const isDark = theme === 'dark';

  // 对话状态
  const [conversations, setConversations] = useState<API.Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<API.Message[]>([]);
  const [models, setModels] = useState<API.Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');

  // 输入状态
  const [inputText, setInputText] = useState('');
  const [pendingImages, setPendingImages] = useState<{ file: File; preview: string }[]>([]);

  // 流式处理状态
  const [loading, setLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 设置弹窗
  const [showSettings, setShowSettings] = useState(false);

  // System Prompt
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const currentConv = conversations.find(c => c.id === currentConvId) ?? null;
  const currentSystemPrompt = currentConv?.system_prompt ?? '';

  // 模型对比
  const [showCompare, setShowCompare] = useState(false);

  // 对话重命名状态
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 响应式监听
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // 主题持久化
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('timo-theme', theme);
  }, [theme]);

  // 登录检查 & 初始化
  useEffect(() => {
    if (!isLoggedIn) {
      history.push('/login');
      return;
    }
    loadInitData();
  }, [isLoggedIn]);

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        handleCreateChat();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [conversations]);

  const loadInitData = async () => {
    try {
      const [convs, availableModels] = await Promise.all([
        getConversations(),
        getAvailableModels(),
      ]);
      setConversations(convs);
      setModels(availableModels);
      if (availableModels.length > 0) setSelectedModel(availableModels[0].model_id);
      if (convs.length > 0) handleSelectConversation(convs[0].id);
    } catch (error) {
      console.error(error);
    }
  };

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleCreateChat = async () => {
    try {
      const newConv = await createConversation('新对话');
      setConversations(prev => [newConv, ...prev]);
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
      const newConvs = conversations.filter(c => c.id !== id);
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
      setConversations(prev =>
        prev.map(c => c.id === editingTitleId ? { ...c, title: editingTitle.trim() } : c)
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
      setConversations(prev =>
        prev.map(c => c.id === currentConvId ? { ...c, system_prompt: prompt } : c)
      );
      antdMessage.success('System Prompt 已保存');
    } catch (e) {
      antdMessage.error('保存失败');
    }
  };


  // 核心发送函数（兼容 send + regenerate）
  const streamChat = async (convId: string, userMsg: API.Message | null, isRegenerate = false) => {
    setLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const token = localStorage.getItem('token');
      const url = isRegenerate
        ? `/api/conversations/${convId}/regenerate`
        : `/api/conversations/${convId}/chat`;

      let body: any = { model: selectedModel };
      if (!isRegenerate && userMsg) {
        body.message = userMsg.content.replace(/\[IMAGE_DATA:[^\]]+\]/g, '').trim() || userMsg.content;
        // 提取图片 base64
        const imgMatches = [...userMsg.content.matchAll(/\[IMAGE_DATA:([^\]]+)\]/g)];
        if (imgMatches.length > 0) {
          body.images = imgMatches.map(m => m[1]);
          body.message = userMsg.content.replace(/\[IMAGE_DATA:[^\]]+\]/g, '').trim();
        }
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      // 添加空 assistant 消息占位
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            setMessages(prev => {
              const newMessages = [...prev];
              const lastMsg = newMessages[newMessages.length - 1];
              if (lastMsg.role === 'assistant') {
                if (parsed.content) lastMsg.content += parsed.content;
                if (parsed.error) lastMsg.content = `❌ 错误：${parsed.error}`;
              }
              return newMessages;
            });
            if (parsed.title) {
              setConversations(prev =>
                prev.map(c => c.id === convId ? { ...c, title: parsed.title } : c)
              );
            }
          } catch (e) {
            // ignore parse errors
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        antdMessage.error('发送失败，请检查网络和 API 配置');
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
    if (!convId) {
      const newConv = await createConversation('新对话');
      setConversations(prev => [newConv, ...prev]);
      convId = newConv.id;
      setCurrentConvId(convId);
    }

    // 构建用户消息内容（文字 + 图片标记）
    let content = inputText;
    if (pendingImages.length > 0) {
      const base64s = await Promise.all(pendingImages.map(p => fileToBase64(p.file)));
      content += '\n' + base64s.map(b => `[IMAGE_DATA:${b}]`).join('\n');
    }

    const userMsg: API.Message = { role: 'user', content };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setPendingImages([]);

    await streamChat(convId, userMsg, false);
  };

  const handleRegenerate = async () => {
    if (!currentConvId || loading) return;
    // 删除界面上最后一条 assistant 消息
    setMessages(prev => {
      const newMsgs = [...prev];
      if (newMsgs.length > 0 && newMsgs[newMsgs.length - 1].role === 'assistant') {
        newMsgs.pop();
      }
      return newMsgs;
    });
    await streamChat(currentConvId, null, true);
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const handleCopyMessage = (content: string) => {
    const displayContent = extractDisplayContent(content);
    navigator.clipboard.writeText(displayContent);
    antdMessage.success('已复制到剪贴板');
  };

  const handleImageAdd = (file: File) => {
    const preview = URL.createObjectURL(file);
    setPendingImages(prev => [...prev, { file, preview }]);
    return false; // 阻止 antd Upload 自动上传
  };

  const handleImageRemove = (index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  };

  // Sidebar 内容
  const siderContent = (
    <div className={`sider-inner ${isDark ? 'dark' : ''}`}>
      <div className="sider-top">
        <Button
          type="text"
          icon={<PlusOutlined />}
          onClick={handleCreateChat}
          className="new-chat-btn"
          title="新对话 (Ctrl+N)"
        >
          发起新对话
        </Button>

        <div className="conv-list">
          <div className="conv-list-label">对话</div>
          {conversations.map(conv => (
            <div
              key={conv.id}
              className={`conversation-item ${currentConvId === conv.id ? 'active' : ''}`}
              onClick={() => handleSelectConversation(conv.id)}
            >
              {editingTitleId === conv.id ? (
                <div className="title-edit" onClick={e => e.stopPropagation()}>
                  <Input
                    size="small"
                    value={editingTitle}
                    onChange={e => setEditingTitle(e.target.value)}
                    onPressEnter={handleRenameConfirm}
                    autoFocus
                  />
                  <Button type="text" size="small" icon={<CheckOutlined />} onClick={handleRenameConfirm} />
                  <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setEditingTitleId(null)} />
                </div>
              ) : (
                <>
                  <span className="conv-title">{conv.title}</span>
                  <div className="conv-actions">
                    <Button
                      type="text" size="small" icon={<EditOutlined />}
                      className="action-btn"
                      onClick={(e) => handleRenameStart(conv, e)}
                    />
                    <Popconfirm
                      title="删除对话" description="确定要删除这个对话吗？"
                      onConfirm={(e) => handleDeleteConversation(conv.id, e as any)}
                      onCancel={(e) => (e as any)?.stopPropagation()}
                    >
                      <Button
                        type="text" size="small" icon={<DeleteOutlined />}
                        className="action-btn delete-btn"
                        onClick={e => e.stopPropagation()}
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
          block icon={isDark ? <SunOutlined /> : <MoonOutlined />}
          onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          className="sider-action-btn"
        >
          {isDark ? '浅色模式' : '深色模式'}
        </Button>
        <Button
          block icon={<SettingOutlined />}
          onClick={() => setShowSettings(true)}
          className="sider-action-btn"
        >
          设置
        </Button>
        <Button
          block icon={<LogoutOutlined />}
          onClick={logout}
          className="sider-action-btn"
          danger
        >
          退出登录
        </Button>
      </div>
    </div>
  );

  const lastAssistantIdx = [...messages].map(m => m.role).lastIndexOf('assistant');

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      }}
    >
      <Layout className={`chat-layout ${isDark ? 'dark' : ''}`}>
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
                    type="text" icon={<MenuOutlined />}
                    onClick={() => setSiderVisible(true)}
                  />
                )}
                <span className="header-title">Timo</span>
                {currentConvId && (
                  <Tooltip title={currentSystemPrompt ? '编辑 System Prompt（已激活）' : '设置 System Prompt'}>
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => setShowSystemPrompt(true)}
                      style={{
                        color: currentSystemPrompt ? '#f59e0b' : undefined,
                        fontWeight: currentSystemPrompt ? 600 : undefined,
                      }}
                    >
                      {currentSystemPrompt ? 'System Prompt ✦' : 'System Prompt'}
                    </Button>
                  </Tooltip>
                )}
              </div>
              <div className="header-right">
                {models.length >= 2 && (
                  <Tooltip title="多模型并行对比">
                    <Button
                      type="text" size="small"
                      icon={<ThunderboltOutlined />}
                      onClick={() => setShowCompare(true)}
                      style={{ color: '#f59e0b' }}
                    >
                      对比
                    </Button>
                  </Tooltip>
                )}
                <span className="header-username">{currentUser?.username}</span>
                <Avatar style={{ backgroundColor: '#2563eb' }} icon={<UserOutlined />}>
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
                  <div
                    key={idx}
                    className={`message-row ${msg.role}`}
                  >
                    {msg.role === 'assistant' && (
                      <Avatar className="msg-avatar assistant-avatar" size={32}>AI</Avatar>
                    )}
                    <div className={`message-bubble ${msg.role}`}>
                      {msg.role === 'user' ? (
                        <div className="user-content">
                          {hasImage(msg.content) && (
                            <div className="image-preview-row">📷 图片</div>
                          )}
                          {extractDisplayContent(msg.content)}
                        </div>
                      ) : (
                        <MarkdownRenderer content={msg.content} isDark={isDark} />
                      )}
                    </div>
                    {/* Message Actions */}
                    <div className={`msg-actions ${msg.role}`}>
                      <Tooltip title="复制">
                        <Button
                          type="text" size="small"
                          icon={<CopyOutlined />}
                          onClick={() => handleCopyMessage(msg.content)}
                          className="msg-action-btn"
                        />
                      </Tooltip>
                      {msg.role === 'assistant' && idx === lastAssistantIdx && !loading && (
                        <Tooltip title="重新生成">
                          <Button
                            type="text" size="small"
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
                        type="text" size="small" danger
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

                <Input
                  ref={inputRef as any}
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onPressEnter={e => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="问问 Timo… (Shift+Enter 换行)"
                  bordered={false}
                  disabled={loading}
                  className="chat-input"
                />

                <Select
                  value={selectedModel}
                  onChange={setSelectedModel}
                  options={models.map(m => ({ label: m.display_name, value: m.model_id }))}
                  bordered={false}
                  style={{ minWidth: 120, maxWidth: 180 }}
                  disabled={loading}
                  placeholder="选择模型"
                />

                {loading ? (
                  <Tooltip title="停止生成">
                    <Button
                      danger shape="circle"
                      icon={<StopOutlined />}
                      onClick={handleStop}
                      className="send-btn"
                    />
                  </Tooltip>
                ) : (
                  <Button
                    type="primary" shape="circle"
                    icon={<SendOutlined />}
                    disabled={!inputText.trim() && pendingImages.length === 0}
                    onClick={sendMessage}
                    className="send-btn"
                  />
                )}
              </div>
              <div className="input-hint">Timo 是一款 AI 工具，其回答未必正确无误。Shift+Enter 换行</div>
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
      </Layout>
    </ConfigProvider>
  );
};
