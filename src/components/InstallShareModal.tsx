import { CopyOutlined, ExportOutlined, LinkOutlined } from "@ant-design/icons";
import { App, Button, Input, Modal, Space, Typography } from "antd";
import { guessPrimaryCommand } from "@/utils/installShare";

type InstallShareModalProps = {
  open: boolean;
  share: API.InstallShare | null;
  onClose: () => void;
};

async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  throw new Error("当前环境不支持剪贴板复制");
}

export function InstallShareModal({
  open,
  share,
  onClose,
}: InstallShareModalProps) {
  const { message } = App.useApp();

  if (!share) {
    return null;
  }

  const primaryCommand = guessPrimaryCommand(share.commands);

  const handleCopy = async (value: string, label: string) => {
    try {
      await copyText(value);
      message.success(`${label}已复制`);
    } catch (error: any) {
      message.error(error?.message || `${label}复制失败`);
    }
  };

  return (
    <Modal
      title={`${share.kind === "mcp" ? "MCP" : "Skill"} 安装分享`}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          把下面的安装链接发给别人后，对方可以在浏览器里打开，直接唤起
          Workhorse 安装。
        </Typography.Paragraph>

        <div>
          <Typography.Text strong>安装链接</Typography.Text>
          <Space.Compact style={{ width: "100%", marginTop: 8 }}>
            <Input value={share.share_url} readOnly />
            <Button
              icon={<CopyOutlined />}
              onClick={() => handleCopy(share.share_url, "安装链接")}
            >
              复制
            </Button>
            <Button
              icon={<LinkOutlined />}
              onClick={() => window.open(share.share_url, "_blank")}
            >
              打开
            </Button>
          </Space.Compact>
        </div>

        <div>
          <Typography.Text strong>Shell 命令</Typography.Text>
          <Space.Compact style={{ width: "100%", marginTop: 8 }}>
            <Input value={primaryCommand} readOnly />
            <Button
              icon={<ExportOutlined />}
              onClick={() => handleCopy(primaryCommand, "Shell 命令")}
            >
              复制命令
            </Button>
          </Space.Compact>
        </div>

        <Typography.Text type="secondary">
          已对常见敏感字段做脱敏处理；接收方安装后仍可在本地补全密钥与配置。
        </Typography.Text>
      </Space>
    </Modal>
  );
}
