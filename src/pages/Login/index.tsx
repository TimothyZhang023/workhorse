import { login, register } from "@/services/api";
import { LockOutlined, UserOutlined, BulbOutlined } from "@ant-design/icons";
import { ProForm, ProFormText } from "@ant-design/pro-components";
import { history, useModel } from "@umijs/max";
import { message, Tabs, ConfigProvider } from "antd";
import { useEffect, useState } from "react";

export default () => {
  const [type, setType] = useState<string>("login");
  const { login: loginModel, isLoggedIn } = useModel("global");

  useEffect(() => {
    if (isLoggedIn) {
      history.replace("/chat");
    }
  }, [isLoggedIn]);

  const handleSubmit = async (
    values: API.LoginParams & { confirmPassword?: string }
  ) => {
    try {
      if (type === "register") {
        if (values.password !== values.confirmPassword) {
          message.error("两次输入的密码不一致");
          return;
        }
        const res = await register(values);
        if (res.token) {
          message.success("注册成功");
          await loginModel(res.user, res.token);
        }
      } else {
        const res = await login(values);
        if (res.token) {
          message.success("登录成功");
          await loginModel(res.user, res.token);
        }
      }
    } catch (error: any) {
      const msg =
        error?.response?.data?.error ||
        error?.data?.error ||
        error?.message ||
        (type === "login"
          ? "登录失败，请检查用户名或密码"
          : "注册失败，请稍后重试");
      message.error(msg);
    }
  };

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#4f46e5",
          borderRadius: 12,
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        },
      }}
    >
      <div
        style={{
          background: "linear-gradient(135deg, #e0e7ff 0%, #ede9fe 50%, #f3e8ff 100%)",
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Soft floating background blobs */}
        <div className="blob-float" style={{ position: "absolute", top: "-10%", left: "-10%", width: "40vw", height: "40vw", background: "linear-gradient(135deg, #a78bfa, #818cf8)", borderRadius: "50%", filter: "blur(100px)", opacity: 0.6 }} />
        <div className="blob-float-delayed" style={{ position: "absolute", bottom: "-10%", right: "-10%", width: "40vw", height: "40vw", background: "linear-gradient(135deg, #c084fc, #e879f9)", borderRadius: "50%", filter: "blur(100px)", opacity: 0.6 }} />
        <div className="blob-float" style={{ position: "absolute", top: "40%", left: "60%", width: "30vw", height: "30vw", background: "linear-gradient(135deg, #60a5fa, #3b82f6)", borderRadius: "50%", filter: "blur(100px)", opacity: 0.4, animationDelay: "-5s" }} />

        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 420,
            margin: "0 20px",
            background: "rgba(255, 255, 255, 0.7)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderRadius: "24px",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.08), 0 0 1px rgba(0,0,0,0.1)",
            padding: "40px 32px",
            border: "1px solid rgba(255,255,255,0.8)",
          }}
        >
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, #4f46e5, #8b5cf6)", color: "white", fontSize: 28, marginBottom: 16, boxShadow: "0 10px 15px -3px rgba(79, 70, 229, 0.3)" }}>
              <BulbOutlined />
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: "#1e1b4b", letterSpacing: "-0.5px" }}>Gemini Chat</h1>
            <p style={{ marginTop: 8, color: "#6b7280", fontSize: 14 }}>A premium AI conversation experience</p>
          </div>

          <ProForm
            submitter={{
              render: (_, dom) => (
                <div style={{ display: "flex", width: "100%" }}>
                  {dom[1]}
                </div>
              ),
              searchConfig: {
                submitText: type === "login" ? "进入系统" : "立即注册",
              },
              submitButtonProps: {
                size: "large",
                style: { width: "100%", borderRadius: 12, height: 48, fontSize: 16, fontWeight: 600, marginTop: 8, background: "linear-gradient(135deg, #4f46e5, #8b5cf6)", border: "none", color: "white" },
              },
            }}
            onFinish={async (values) => {
              await handleSubmit(values as any);
            }}
          >
            <Tabs
              activeKey={type}
              onChange={setType}
              centered
              style={{ marginBottom: 24 }}
              items={[
                {
                  key: "login",
                  label: <span style={{ fontSize: 16, fontWeight: 500 }}>登录</span>,
                },
                {
                  key: "register",
                  label: <span style={{ fontSize: 16, fontWeight: 500 }}>注册</span>,
                },
              ]}
            />

            <ProFormText
              name="username"
              fieldProps={{
                size: "large",
                style: { borderRadius: 12 },
                prefix: <UserOutlined style={{ color: "rgba(0,0,0,0.25)" }} />,
              }}
              placeholder={"请输入用户名"}
              rules={[
                {
                  required: true,
                  message: "请输入用户名!",
                },
              ]}
            />
            <ProFormText.Password
              name="password"
              fieldProps={{
                size: "large",
                style: { borderRadius: 12 },
                prefix: <LockOutlined style={{ color: "rgba(0,0,0,0.25)" }} />,
              }}
              placeholder={"请输入密码"}
              rules={[
                {
                  required: true,
                  message: "请输入密码！",
                },
              ]}
            />

            {type === "register" && (
              <ProFormText.Password
                name="confirmPassword"
                fieldProps={{
                  size: "large",
                  style: { borderRadius: 12 },
                  prefix: <LockOutlined style={{ color: "rgba(0,0,0,0.25)" }} />,
                }}
                placeholder={"请再次输入密码"}
                rules={[
                  {
                    required: true,
                    message: "请确认你的密码！",
                  },
                ]}
              />
            )}
          </ProForm>
        </div>
      </div>
    </ConfigProvider>
  );
};
