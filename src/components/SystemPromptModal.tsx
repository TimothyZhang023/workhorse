import { useState } from 'react';
import { Modal, Input, Button, Card, Tag, Tooltip, Space, Typography } from 'antd';
import { EditOutlined, ThunderboltOutlined } from '@ant-design/icons';

const { TextArea } = Input;
const { Text } = Typography;

// ============ 内置 Prompt 模板 ============
const PROMPT_TEMPLATES = [
    {
        name: '通用助手',
        tag: '通用',
        color: 'blue',
        prompt: '你是一个聪明、诚实、有帮助的 AI 助手。请用清晰、简洁的语言回答问题。',
    },
    {
        name: '代码专家',
        tag: '开发',
        color: 'green',
        prompt:
            '你是一名资深软件工程师，擅长多种编程语言和框架。回答时请优先提供可运行的代码示例，并解释关键逻辑。对于复杂问题，先拆解思路再给出实现。',
    },
    {
        name: '代码审查官',
        tag: '开发',
        color: 'green',
        prompt:
            '你是一名代码审查专家。请对用户提供的代码进行全面审查，包括：代码质量、潜在 Bug、性能问题、安全漏洞、可读性和最佳实践。以结构化方式给出反馈。',
    },
    {
        name: '英文翻译',
        tag: '语言',
        color: 'purple',
        prompt:
            '你是一名专业翻译，擅长中英文互译。请将用户的输入翻译成地道、流畅的目标语言。如果输入是中文，翻译成英文；如果是英文，翻译成中文。同时指出原文中的任何语法或表达问题。',
    },
    {
        name: '写作助手',
        tag: '写作',
        color: 'orange',
        prompt:
            '你是一名专业写作助手。帮助用户改善文章结构、措辞和表达，使内容更加清晰、有力。提供具体的修改建议，并解释修改原因。保持原文的核心意思不变。',
    },
    {
        name: '学术写作',
        tag: '写作',
        color: 'orange',
        prompt:
            '你是一名学术写作专家。帮助用户撰写或改进学术论文、研究报告。确保语言正式、论据充分、逻辑严密。注意学术诚信，引用要规范。',
    },
    {
        name: 'Socratic 老师',
        tag: '教学',
        color: 'cyan',
        prompt:
            '你是一名采用苏格拉底式教学法的老师。不要直接给出答案，而是通过引导性问题帮助用户自己发现答案和建立理解。在适当时候提供提示，鼓励批判性思维。',
    },
    {
        name: '产品经理',
        tag: '产品',
        color: 'magenta',
        prompt:
            '你是一名经验丰富的产品经理。帮助用户分析产品需求、定义用户故事、梳理功能优先级，并从用户价值和商业价值角度评估功能提案。思维清晰，善于平衡各方诉求。',
    },
    {
        name: '数据分析师',
        tag: '数据',
        color: 'geekblue',
        prompt:
            '你是一名数据分析师，擅长统计分析和数据可视化。帮助用户理解数据、发现规律和洞察。回答时使用具体的数据指标，并建议合适的分析方法或可视化图表。',
    },
    {
        name: '简洁模式',
        tag: '风格',
        color: 'default',
        prompt: '请用最简洁的语言回答。不要冗长解释，直接给出结论和关键信息。',
    },
    {
        name: 'CEO 顾问',
        tag: '商业',
        color: 'gold',
        prompt:
            '你是一名顶级商业顾问，有丰富的企业战略、管理和增长经验。帮助用户分析商业问题，提供战略建议，思考要有高度、有数据支撑、有可执行性。',
    },
    {
        name: '哲学家',
        tag: '思维',
        color: 'volcano',
        prompt:
            '你是一名哲学家，熟悉东西方哲学传统。帮助用户探讨思想、价值观和存在的深层问题。鼓励多角度思考，引用相关哲学流派和思想家的观点，同时保持开放和批判性思维。',
    },
];

interface SystemPromptModalProps {
    open: boolean;
    onClose: () => void;
    conversationId: string | null;
    currentPrompt: string;
    onSave: (prompt: string) => Promise<void>;
}

export const SystemPromptModal = ({
    open,
    onClose,
    conversationId,
    currentPrompt,
    onSave,
}: SystemPromptModalProps) => {
    const [prompt, setPrompt] = useState(currentPrompt);
    const [saving, setSaving] = useState(false);

    // 同步外部 currentPrompt 变化（切换对话时）
    useState(() => {
        setPrompt(currentPrompt);
    });

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave(prompt);
            onClose();
        } finally {
            setSaving(false);
        }
    };

    const handleApplyTemplate = (templatePrompt: string) => {
        setPrompt(templatePrompt);
    };

    return (
        <Modal
            title={
                <Space>
                    <EditOutlined />
                    <span>System Prompt</span>
                    {conversationId && (
                        <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                            当前对话
                        </Text>
                    )}
                </Space>
            }
            open={open}
            onCancel={onClose}
            width={780}
            footer={[
                <Button key="clear" onClick={() => setPrompt('')}>清空</Button>,
                <Button key="cancel" onClick={onClose}>取消</Button>,
                <Button key="save" type="primary" loading={saving} onClick={handleSave}>
                    保存
                </Button>,
            ]}
        >
            <div style={{ marginBottom: 16 }}>
                <TextArea
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder="输入系统提示词，定义 AI 的角色、行为风格和专注领域...&#10;&#10;例如：你是一名资深 Python 工程师，擅长数据处理和机器学习，回答时优先给出可运行的代码。"
                    autoSize={{ minRows: 5, maxRows: 12 }}
                    style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
                <div style={{ textAlign: 'right', marginTop: 4, fontSize: 12, color: '#9ca3af' }}>
                    {prompt.length} 字符
                </div>
            </div>

            <div>
                <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ThunderboltOutlined style={{ color: '#f59e0b' }} />
                    <span style={{ fontWeight: 600, fontSize: 13 }}>模板库</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>点击即可应用</Text>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {PROMPT_TEMPLATES.map(tpl => (
                        <Tooltip key={tpl.name} title={tpl.prompt} placement="top" overlayStyle={{ maxWidth: 340 }}>
                            <Card
                                size="small"
                                hoverable
                                onClick={() => handleApplyTemplate(tpl.prompt)}
                                style={{ cursor: 'pointer', padding: '2px 0' }}
                                bodyStyle={{ padding: '6px 12px' }}
                            >
                                <Space size={6}>
                                    <span style={{ fontSize: 13, fontWeight: 500 }}>{tpl.name}</span>
                                    <Tag color={tpl.color} style={{ fontSize: 11, margin: 0 }}>{tpl.tag}</Tag>
                                </Space>
                            </Card>
                        </Tooltip>
                    ))}
                </div>
            </div>
        </Modal>
    );
};
