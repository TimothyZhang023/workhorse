import React, { useState, useRef, useEffect } from 'react';
import { 
  Input, 
  Button, 
  Avatar, 
  Card, 
  Space, 
  Typography, 
  Tag, 
  Spin,
  Tooltip
} from 'antd';
import { 
  SendOutlined, 
  RobotOutlined, 
  UserOutlined, 
  SearchOutlined,
  PlusOutlined,
  GlobalOutlined,
  GithubOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';
import { searchMarketMcp } from '@/services/api';
import './ChatMarketplace.css';

const { Text, Paragraph } = Typography;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  results?: API.MarketMcpServer[];
  loading?: boolean;
}

interface ChatMarketplaceProps {
  onImport: (serverName: string, autoCreate: boolean) => Promise<void>;
  importingName: string | null;
}

const INITIAL_SUGGESTIONS = [
  "搜索 GitHub 相关的工具",
  "如何查找 Google 搜索 MCP?",
  "有哪些数据库管理的工具？",
  "搜索文档处理插件"
];

export const ChatMarketplace: React.FC<ChatMarketplaceProps> = ({ onImport, importingName }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '你好！我是 Workhorse MCP 助手。在这里你可以通过对话发现并安装成千上万的 MCP 服务，扩展你的 Agent 能力。你想找什么样的工具？',
      timestamp: new Date(),
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [searching, setSearching] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (text: string) => {
    if (!text.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setSearching(true);

    const assistantMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: new Date(),
    }]);

    try {
      const results = await searchMarketMcp(text);
      
      setMessages(prev => prev.map(m => m.id === assistantMsgId ? {
        ...m,
        content: results.length > 0 
          ? `我为你找到了 ${results.length} 个相关的 MCP 服务器：` 
          : '抱歉，我没有找到相关的 MCP 服务器。你可以尝试换个关键词，比如 "github" 或 "browser"。',
        results,
        loading: false
      } : m));
    } catch (error) {
      setMessages(prev => prev.map(m => m.id === assistantMsgId ? {
        ...m,
        content: '搜索出错，请稍后再试。',
        loading: false
      } : m));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="chat-marketplace">
      <div className="chat-messages" ref={scrollRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={`message-item ${msg.role}`}>
            <Avatar 
              icon={msg.role === 'assistant' ? <RobotOutlined /> : <UserOutlined />} 
              style={{ backgroundColor: msg.role === 'assistant' ? '#10b981' : '#3b82f6' }}
            />
            <div className="message-content">
              {msg.loading ? (
                <div className="thinking">
                  <Spin size="small" />
                  <Text type="secondary" style={{ marginLeft: 8 }}>正在从 Registry 检索...</Text>
                </div>
              ) : (
                <>
                  <Paragraph style={{ margin: 0 }}>{msg.content}</Paragraph>
                  {msg.results && msg.results.length > 0 && (
                    <div className="tool-results">
                      <Space direction="vertical" style={{ width: '100%' }}>
                        {msg.results.slice(0, 5).map((tool) => (
                          <Card 
                            key={tool.name} 
                            size="small" 
                            className="tool-card-compact"
                            actions={[
                              <Button 
                                key="draft"
                                type="link" 
                                size="small" 
                                loading={importingName === tool.name}
                                onClick={() => onImport(tool.name, false)}
                              >
                                配置
                              </Button>,
                              <Button 
                                key="install"
                                type="primary" 
                                size="small" 
                                loading={importingName === tool.name}
                                onClick={() => onImport(tool.name, true)}
                              >
                                一键安装
                              </Button>
                            ]}
                          >
                            <Card.Meta
                              title={
                                <Space>
                                  <Text strong>{tool.title || tool.name}</Text>
                                  {tool.repository_url?.includes('github') && <GithubOutlined style={{ color: '#000' }} />}
                                </Space>
                              }
                              description={
                                <div className="tool-card-desc">
                                  <Text type="secondary" ellipsis={{ tooltip: tool.description }}>
                                    {tool.description}
                                  </Text>
                                  <div style={{ marginTop: 4 }}>
                                    {tool.transport === 'stdio' && <Tag color="blue" bordered={false}>Local</Tag>}
                                    {tool.transport === 'sse' && <Tag color="purple" bordered={false}>Remote</Tag>}
                                  </div>
                                </div>
                              }
                            />
                          </Card>
                        ))}
                      </Space>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        {messages.length === 1 && (
          <div className="suggestions-grid">
            {INITIAL_SUGGESTIONS.map(s => (
              <Button 
                key={s} 
                className="suggestion-btn" 
                onClick={() => handleSend(s)}
                icon={<ThunderboltOutlined />}
              >
                {s}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="chat-input-area">
        <Input
          placeholder="描述你想要的工具，例如 '搜索 GitHub 仓库'..."
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onPressEnter={() => handleSend(inputValue)}
          disabled={searching}
          suffix={
            <Button 
              type="text" 
              icon={<SendOutlined />} 
              onClick={() => handleSend(inputValue)}
              loading={searching}
            />
          }
        />
      </div>
    </div>
  );
};
