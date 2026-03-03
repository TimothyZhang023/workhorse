import { useState, useEffect, useRef } from 'react';
import { Layout, Button, Input, Select, Avatar, Empty, Popconfirm, message as antdMessage } from 'antd';
import { PlusOutlined, DeleteOutlined, SettingOutlined, LogoutOutlined, UserOutlined, SendOutlined } from '@ant-design/icons';
import { useModel, history } from '@umijs/max';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SettingsModal } from '@/components/SettingsModal';
import {
  getConversations,
  createConversation,
  deleteConversation,
  getMessages,
  getAvailableModels,
} from '@/services/api';
import './index.css';

const { Sider, Content } = Layout;

export default () => {
  const { currentUser, logout, isLoggedIn } = useModel('global');
  const [conversations, setConversations] = useState<API.Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<API.Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [models, setModels] = useState<API.Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initial Data Load
  useEffect(() => {
    if (!isLoggedIn) {
      history.push('/login');
      return;
    }
    loadInitData();
  }, [isLoggedIn]);

  const loadInitData = async () => {
    try {
      const [convs, availableModels] = await Promise.all([
        getConversations(),
        getAvailableModels(),
      ]);
      setConversations(convs);
      setModels(availableModels);
      if (availableModels.length > 0) {
        setSelectedModel(availableModels[0].model_id);
      }
      if (convs.length > 0) {
        handleSelectConversation(convs[0].id);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleCreateChat = async () => {
    try {
      const newConv = await createConversation('新对话');
      setConversations([newConv, ...conversations]);
      handleSelectConversation(newConv.id);
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

  const sendMessage = async () => {
    if (!inputText.trim() || loading) return;

    let convId = currentConvId;
    if (!convId) {
      const newConv = await createConversation('新对话');
      setConversations([newConv, ...conversations]);
      convId = newConv.id;
      setCurrentConvId(convId);
    }

    const newMessage: API.Message = { role: 'user', content: inputText };
    setMessages(prev => [...prev, newMessage]);
    setInputText('');
    setLoading(true);

    try {
      // Setup SSE
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/conversations/${convId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message: newMessage.content,
          model: selectedModel
        })
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      // Add empty assistant message
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
             // Update messages state functionaly to avoid closure stale state
             setMessages(prev => {
                const newMessages = [...prev];
                const lastMsg = newMessages[newMessages.length - 1];

                if (lastMsg.role === 'assistant') {
                    if (parsed.content) {
                        lastMsg.content += parsed.content;
                    }
                    if (parsed.error) {
                        lastMsg.content = `Error: ${parsed.error}`;
                    }
                }
                return newMessages;
             });

             if (parsed.title) {
                 setConversations(prev => prev.map(c =>
                     c.id === convId ? { ...c, title: parsed.title } : c
                 ));
             }

          } catch (e) {
            console.error('Parse error', e);
          }
        }
      }

    } catch (error) {
      console.error(error);
      antdMessage.error('Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Sider width={260} theme="light" style={{ borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Button
            type="text"
            icon={<PlusOutlined />}
            onClick={handleCreateChat}
            style={{
              marginBottom: 16,
              background: '#f3f4f6',
              borderRadius: '9999px',
              height: '48px',
              justifyContent: 'flex-start',
              paddingLeft: '20px'
            }}
          >
            发起新对话
          </Button>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div style={{ padding: '0 12px', marginBottom: 8, fontSize: 12, color: '#6b7280', fontWeight: 500 }}>对话</div>
            {conversations.map(conv => (
              <div
                key={conv.id}
                className={`conversation-item ${currentConvId === conv.id ? 'active' : ''}`}
                onClick={() => handleSelectConversation(conv.id)}
              >
                <span className="truncate">{conv.title}</span>
                <Popconfirm
                  title="删除对话"
                  description="确定要删除这个对话吗？"
                  onConfirm={(e) => handleDeleteConversation(conv.id, e as any)}
                  onCancel={(e) => e?.stopPropagation()}
                >
                  <Button
                    type="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    className="delete-btn"
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popconfirm>
              </div>
            ))}
            {conversations.length === 0 && (
               <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: 20, fontSize: 14 }}>暂无对话记录</div>
            )}
          </div>

          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
            <Button block icon={<SettingOutlined />} onClick={() => setShowSettings(true)} style={{ marginBottom: 8, textAlign: 'left' }}>设置</Button>
            <Button block icon={<LogoutOutlined />} onClick={logout} style={{ textAlign: 'left' }}>退出登录</Button>
          </div>
        </div>
      </Sider>

      <Layout>
        <Content style={{ display: 'flex', flexDirection: 'column', background: 'white' }}>
          {/* Header */}
          <div style={{ padding: '12px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <span style={{ fontSize: 20, color: '#041e49' }}>Gemini</span>
             <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                 <span style={{ fontSize: 14, color: '#4b5563' }}>{currentUser?.username}</span>
                 <Avatar style={{ backgroundColor: '#2563eb' }} icon={<UserOutlined />} >{currentUser?.username?.[0]?.toUpperCase()}</Avatar>
             </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 15%' }}>
             {messages.length === 0 ? (
                 <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
                     开始新对话...
                 </div>
             ) : (
                 messages.map((msg, idx) => (
                     <div key={idx} style={{ marginBottom: 24, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                         <div className={`message-bubble ${msg.role}`}>
                             {msg.role === 'user' ? (
                                 msg.content
                             ) : (
                                 <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose">
                                     {msg.content}
                                 </ReactMarkdown>
                             )}
                         </div>
                     </div>
                 ))
             )}
             <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div style={{ padding: '16px 15%', paddingBottom: 24 }}>
             <div className="input-container">
                 <Input
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onPressEnter={sendMessage}
                    placeholder="问问 Gemini"
                    bordered={false}
                    disabled={loading}
                    style={{ flex: 1, fontSize: 16 }}
                 />
                 <Select
                    value={selectedModel}
                    onChange={setSelectedModel}
                    options={models.map(m => ({ label: m.display_name, value: m.model_id }))}
                    bordered={false}
                    style={{ width: 120 }}
                    disabled={loading}
                 />
                 <Button
                    type="primary"
                    shape="circle"
                    icon={<SendOutlined />}
                    disabled={loading || !inputText.trim()}
                    onClick={sendMessage}
                 />
             </div>
             <div style={{ textAlign: 'center', color: '#6b7280', fontSize: 12, marginTop: 12 }}>
                 Gemini 是一款 AI 工具，其回答未必正确无误。
             </div>
          </div>
        </Content>
      </Layout>

      <SettingsModal open={showSettings} onOpenChange={setShowSettings} />
    </Layout>
  );
};
