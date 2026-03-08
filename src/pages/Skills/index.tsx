import { AccountModal } from "@/components/AccountModal";
import { SettingsModal } from "@/components/SettingsModal";
import { Sidebar } from "@/components/Sidebar";
import {
  createSkill,
  deleteSkill,
  getSkills,
  updateSkill,
} from "@/services/api";
import { PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import {
  ModalForm,
  ProFormText,
  ProFormTextArea,
  ProList,
} from "@ant-design/pro-components";
import { useModel } from "@umijs/max";
import {
  theme as antdTheme,
  Button,
  Card,
  ConfigProvider,
  message,
  Space,
} from "antd";
import { useEffect, useState } from "react";
import "../Dashboard/index.css";

export default () => {
  const { currentUser, isLoggedIn } = useModel("global");
  const [moduleExpanded, setModuleExpanded] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [showAccount, setShowAccount] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<API.Skill[]>([]);
  const [editingSkill, setEditingSkill] = useState<Partial<API.Skill> | null>(
    null
  );

  const isDark = theme === "dark";

  const loadSkills = async () => {
    setLoading(true);
    try {
      const data = await getSkills();
      setSkills(data);
    } catch (e) {
      message.error("加载技能失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSkills();
  }, []);

  return (
    <ConfigProvider
      wave={{ disabled: true }}
      theme={{
        algorithm: isDark
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm,
        token: { motion: false },
      }}
    >
      <div className={`cw-dashboard-layout ${isDark ? "dark" : ""}`}>
        <Sidebar
          moduleExpanded={moduleExpanded}
          setModuleExpanded={setModuleExpanded}
          theme={theme}
          setTheme={setTheme}
          activePath="/skills"
          setShowAccount={setShowAccount}
          setShowSettings={setShowSettings}
        />

        <main className="cw-dashboard-main-wrap">
          <section className="cw-dashboard-hero">
            <div>
              <div className="cw-dashboard-eyebrow">Skills</div>
              <h1>技能库</h1>
              <p>
                定义 AI 专家的核心能力，通过 System Prompt 和工具集扩展 Agent
                的边界。
              </p>
            </div>
          </section>

          <section className="cw-dashboard-main">
            <Card className="cw-module-card">
              <div
                style={{
                  marginBottom: 16,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <Space>
                  <ThunderboltOutlined
                    style={{ fontSize: 20, color: "#f59e0b" }}
                  />
                  <h3 style={{ margin: 0 }}>我的技能</h3>
                </Space>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setEditingSkill({})}
                >
                  添加技能
                </Button>
              </div>

              <ProList<API.Skill>
                rowKey="id"
                dataSource={skills}
                loading={loading}
                metas={{
                  title: {
                    dataIndex: "name",
                    render: (text) => <b>{text}</b>,
                  },
                  description: {
                    dataIndex: "description",
                  },
                  actions: {
                    render: (_, row) => [
                      <a key="edit" onClick={() => setEditingSkill(row)}>
                        编辑
                      </a>,
                      <a
                        key="delete"
                        style={{ color: "red" }}
                        onClick={async () => {
                          await deleteSkill(row.id);
                          message.success("已删除");
                          loadSkills();
                        }}
                      >
                        删除
                      </a>,
                    ],
                  },
                }}
              />
            </Card>
          </section>
        </main>

        <ModalForm
          title={editingSkill?.id ? "编辑技能" : "添加技能"}
          open={!!editingSkill}
          onOpenChange={(v) => !v && setEditingSkill(null)}
          modalProps={{ destroyOnClose: true }}
          initialValues={editingSkill || {}}
          onFinish={async (values) => {
            if (editingSkill?.id) {
              await updateSkill(editingSkill.id, values);
            } else {
              await createSkill(values);
            }
            message.success("保存成功");
            loadSkills();
            setEditingSkill(null);
            return true;
          }}
        >
          <ProFormText
            name="name"
            label="技能名称"
            placeholder="如：网页搜索、代码审计"
            rules={[{ required: true }]}
          />
          <ProFormText name="description" label="简介" />
          <ProFormTextArea
            name="prompt"
            label="System Prompt 增强"
            placeholder="描述此技能的具体逻辑、约束和输出格式"
            rules={[{ required: true }]}
          />
        </ModalForm>

        <AccountModal
          open={showAccount}
          onClose={() => setShowAccount(false)}
          isDark={isDark}
        />
        <SettingsModal open={showSettings} onOpenChange={setShowSettings} />
      </div>
    </ConfigProvider>
  );
};
