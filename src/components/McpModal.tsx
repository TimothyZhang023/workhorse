import {
    createMcpServer,
    deleteMcpServer,
    getMcpServers,
    updateMcpServer,
} from "@/services/api";
import { PlusOutlined } from "@ant-design/icons";
import {
    ModalForm,
    ProFormRadio,
    ProFormSwitch,
    ProFormText,
    ProList,
} from "@ant-design/pro-components";
import { Button, Form, message, Space, Tag } from "antd";
import { useEffect, useState } from "react";

export const McpModal = ({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) => {
    const [servers, setServers] = useState<API.McpServer[]>([]);
    const [editingServer, setEditingServer] = useState<API.McpServer | null>(null);
    const [loading, setLoading] = useState(false);

    const loadServers = async () => {
        try {
            setLoading(true);
            const data = await getMcpServers();
            setServers(data);
        } catch (error) {
            console.error(error);
            message.error("获取 MCP 服务器列表失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            loadServers();
        }
    }, [open]);

    const handleDelete = async (id: number) => {
        try {
            await deleteMcpServer(id);
            message.success("删除成功");
            loadServers();
        } catch (error) {
            message.error("删除失败");
        }
    };

    const handleToggleEnable = async (row: API.McpServer, checked: boolean) => {
        try {
            await updateMcpServer(row.id, { is_enabled: checked ? 1 : 0 });
            message.success(checked ? "已启用" : "已禁用");
            loadServers();
        } catch (error) {
            message.error("状态修改失败");
        }
    };

    return (
        <ModalForm
            title="MCP 服务器 / 插件"
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
                <h3>MCP Servers</h3>
                <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                        setEditingServer({ type: "stdio", is_enabled: 1 } as API.McpServer);
                    }}
                >
                    添加 MCP 服务器
                </Button>
            </div>

            <ProList<API.McpServer>
                rowKey="id"
                dataSource={servers}
                loading={loading}
                metas={{
                    title: {
                        dataIndex: "name",
                        render: (text, row) => (
                            <Space>
                                {text}
                                <Tag color={row.type === "stdio" ? "blue" : "purple"}>
                                    {row.type}
                                </Tag>
                                {row.is_enabled === 1 ? (
                                    <Tag color="success">已启用</Tag>
                                ) : (
                                    <Tag color="default">已禁用</Tag>
                                )}
                            </Space>
                        ),
                    },
                    description: {
                        render: (_, row) => {
                            if (row.type === "stdio") {
                                return `命令: ${row.command} ${row.args?.join(" ") || ""}`;
                            }
                            return `URL: ${row.url}`;
                        },
                    },
                    actions: {
                        render: (text, row) => [
                            <a
                                key="toggle"
                                onClick={() => handleToggleEnable(row, row.is_enabled === 0)}
                            >
                                {row.is_enabled === 1 ? "禁用" : "启用"}
                            </a>,
                            <a key="edit" onClick={() => setEditingServer(row)}>
                                编辑
                            </a>,
                            <a
                                key="delete"
                                onClick={() => handleDelete(row.id)}
                                style={{ color: "red" }}
                            >
                                删除
                            </a>,
                        ],
                    },
                }}
            />

            {/* MCP Server Edit Modal */}
            <ModalForm
                title={editingServer?.id ? "编辑 MCP 服务器" : "添加 MCP 服务器"}
                open={!!editingServer}
                onOpenChange={(visible) => !visible && setEditingServer(null)}
                initialValues={editingServer || {}}
                onFinish={async (values) => {
                    try {
                        // 参数预处理，将空格分隔的字符串切分为数组
                        const formValues = { ...values };
                        if (formValues.type === "stdio" && typeof formValues.args === 'string') {
                            formValues.args = formValues.args.trim().split(/\s+/).filter(Boolean);
                        }
                        if (formValues.type === "stdio" && !formValues.command) {
                            message.error("本地命令行必须填写可执行命令");
                            return false;
                        }
                        if (formValues.type === "sse" && !formValues.url) {
                            message.error("远程服务必须填写 URL");
                            return false;
                        }

                        formValues.is_enabled = formValues.is_enabled ? 1 : 0;

                        if (editingServer?.id) {
                            await updateMcpServer(editingServer.id, formValues);
                        } else {
                            await createMcpServer(formValues);
                        }
                        message.success("保存成功");
                        setEditingServer(null);
                        loadServers();
                        return true;
                    } catch (error) {
                        console.error(error);
                        message.error("保存失败");
                        return false;
                    }
                }}
            >
                <ProFormText
                    name="name"
                    label="名称"
                    placeholder="如：Postgres Database"
                    rules={[{ required: true }]}
                />
                <ProFormRadio.Group
                    name="type"
                    label="连接类型"
                    options={[
                        { label: "本地命令 (stdio)", value: "stdio" },
                        { label: "远程服务 (sse)", value: "sse" },
                    ]}
                    rules={[{ required: true }]}
                />

                {/* We use Form.Item dependencies to conditionally render fields in ProForm */}
                <Form.Item
                    noStyle
                    shouldUpdate={(prevValues, currentValues) => prevValues.type !== currentValues.type}
                >
                    {({ getFieldValue }) => {
                        const type = getFieldValue("type");
                        if (type === "stdio") {
                            return (
                                <>
                                    <ProFormText
                                        name="command"
                                        label="可执行命令"
                                        placeholder="如：npx, python, docker"
                                        rules={[{ required: true }]}
                                    />
                                    <ProFormText
                                        name="args"
                                        label="运行参数"
                                        placeholder="如：-y @modelcontextprotocol/server-postgres postgres://... (用空格分隔)"
                                        transform={(val) => {
                                            if (Array.isArray(val)) return val.join(" ");
                                            return val;
                                        }}
                                    />
                                </>
                            );
                        } else if (type === "sse") {
                            return (
                                <ProFormText
                                    name="url"
                                    label="SSE URL"
                                    placeholder="如：http://localhost:3001/sse"
                                    rules={[{ required: true }]}
                                />
                            );
                        }
                        return null;
                    }}
                </Form.Item>

                <ProFormSwitch
                    name="is_enabled"
                    label="启用此服务"
                    initialValue={true}
                />
            </ModalForm>
        </ModalForm>
    );
};
