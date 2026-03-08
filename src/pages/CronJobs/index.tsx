import { AccountModal } from "@/components/AccountModal";
import { SettingsModal } from "@/components/SettingsModal";
import { Sidebar } from "@/components/Sidebar";
import {
  createCronJob,
  deleteCronJob,
  getAgentTasks,
  getCronJobs,
  updateCronJob,
} from "@/services/api";
import { PlusOutlined, ScheduleOutlined } from "@ant-design/icons";
import {
  ModalForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
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
  Tag,
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
  const [jobs, setJobs] = useState<API.CronJob[]>([]);
  const [tasks, setTasks] = useState<API.AgentTask[]>([]);
  const [editingJob, setEditingJob] = useState<Partial<API.CronJob> | null>(
    null
  );

  const isDark = theme === "dark";

  const loadData = async () => {
    setLoading(true);
    try {
      const [j, t] = await Promise.all([getCronJobs(), getAgentTasks()]);
      setJobs(j);
      setTasks(t);
    } catch (e) {
      message.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
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
          activePath="/cron-jobs"
          setShowAccount={setShowAccount}
          setShowSettings={setShowSettings}
        />

        <main className="cw-dashboard-main-wrap">
          <section className="cw-dashboard-hero">
            <div>
              <div className="cw-dashboard-eyebrow">Scheduled Jobs</div>
              <h1>定时调度</h1>
              <p>
                让 Agent 自动运行。支持标准的 Cron
                表达式，定时执行预定义的任务编排。
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
                  <ScheduleOutlined
                    style={{ fontSize: 20, color: "#10b981" }}
                  />
                  <h3 style={{ margin: 0 }}>调度任务</h3>
                </Space>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setEditingJob({ is_enabled: 1 })}
                >
                  创建调度
                </Button>
              </div>

              <ProList<API.CronJob>
                rowKey="id"
                dataSource={jobs}
                loading={loading}
                metas={{
                  title: {
                    dataIndex: "name",
                    render: (text, row) => (
                      <Space>
                        <b>{text}</b>
                        {row.is_enabled ? (
                          <Tag color="success">运行中</Tag>
                        ) : (
                          <Tag>已禁用</Tag>
                        )}
                      </Space>
                    ),
                  },
                  description: {
                    render: (_, row) => {
                      const t = tasks.find((tk) => tk.id === row.task_id);
                      return (
                        <Space
                          direction="vertical"
                          style={{ width: "100%", fontSize: 13 }}
                        >
                          <div>
                            任务:{" "}
                            <Tag color="blue">
                              {t?.name || `Task ${row.task_id}`}
                            </Tag>
                          </div>
                          <div>
                            表达式: <code>{row.cron_expression}</code>
                          </div>
                          {row.next_run && (
                            <div>
                              下次执行:{" "}
                              {new Date(row.next_run).toLocaleString()}
                            </div>
                          )}
                          {row.last_run && (
                            <div>
                              上次执行:{" "}
                              {new Date(row.last_run).toLocaleString()} (
                              {row.last_status})
                            </div>
                          )}
                        </Space>
                      );
                    },
                  },
                  actions: {
                    render: (_, row) => [
                      <a key="edit" onClick={() => setEditingJob(row)}>
                        编辑
                      </a>,
                      <a
                        key="toggle"
                        onClick={async () => {
                          await updateCronJob(row.id, {
                            is_enabled: row.is_enabled ? 0 : 1,
                          });
                          message.success(row.is_enabled ? "已停止" : "已启动");
                          loadData();
                        }}
                      >
                        {row.is_enabled ? "停止" : "启动"}
                      </a>,
                      <a
                        key="delete"
                        style={{ color: "red" }}
                        onClick={async () => {
                          await deleteCronJob(row.id);
                          message.success("已删除");
                          loadData();
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
          title={editingJob?.id ? "编辑调度" : "创建调度"}
          open={!!editingJob}
          onOpenChange={(v) => !v && setEditingJob(null)}
          modalProps={{ destroyOnClose: true }}
          initialValues={editingJob || {}}
          onFinish={async (values) => {
            const data = {
              ...values,
              taskId: values.task_id,
              cronExpression: values.cron_expression,
              is_enabled: values.is_enabled ? 1 : 0,
            };
            if (editingJob?.id) {
              await updateCronJob(editingJob.id, data);
            } else {
              await createCronJob(data);
            }
            message.success("保存成功");
            loadData();
            setEditingJob(null);
            return true;
          }}
        >
          <ProFormText
            name="name"
            label="调度计划名称"
            placeholder="每日数据巡检"
            rules={[{ required: true }]}
          />
          <ProFormSelect
            name="task_id"
            label="选择执行任务"
            options={tasks.map((t) => ({ label: t.name, value: t.id }))}
            rules={[{ required: true }]}
          />
          <ProFormText
            name="cron_expression"
            label="Cron 表达式"
            placeholder="* * * * * 每个月/天/小时/分钟"
            rules={[{ required: true }]}
            extra="例如: 0 0 * * * 表示每天零点执行"
          />
          <ProFormSwitch
            name="is_enabled"
            label="立即启用"
            checkedChildren="启用"
            unCheckedChildren="禁用"
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
