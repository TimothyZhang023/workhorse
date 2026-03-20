import React, { Suspense } from "react";
import { App as AntdApp } from "antd";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppStoreProvider } from "@/stores/useAppStore";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { InstallShareBridge } from "@/components/InstallShareBridge";

const Dashboard = React.lazy(() => import("./pages/Dashboard"));
const Chat = React.lazy(() => import("./pages/Chat"));
const AgentTasks = React.lazy(() => import("./pages/AgentTasks"));
const Mcp = React.lazy(() => import("./pages/Mcp"));
const Skills = React.lazy(() => import("./pages/Skills"));
const CronJobs = React.lazy(() => import("./pages/CronJobs"));
const Endpoints = React.lazy(() => import("./pages/Endpoints"));
const SystemSettings = React.lazy(() => import("./pages/SystemSettings"));

export default function App() {
  return (
    <AppStoreProvider>
      <ThemeProvider>
        <AntdApp>
          <BrowserRouter>
            <InstallShareBridge />
            <Suspense
              fallback={
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100vh",
                    background:
                      "radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.05) 0%, transparent 80%)",
                    backdropFilter: "blur(4px)",
                  }}
                >
                  <div
                    style={{
                      padding: "24px 48px",
                      borderRadius: "16px",
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      boxShadow: "0 8px 32px rgba(0, 0, 0, 0.1)",
                      color: "rgba(255, 255, 255, 0.6)",
                      fontSize: "14px",
                      letterSpacing: "0.1em",
                    }}
                  >
                    LOADING...
                  </div>
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<Navigate to="/agency" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/agency" element={<Chat />} />
                <Route path="/chat" element={<Chat />} />
                <Route path="/agent-tasks" element={<AgentTasks />} />
                <Route path="/mcp" element={<Mcp />} />
                <Route path="/skills" element={<Skills />} />
                <Route path="/cron-jobs" element={<CronJobs />} />
                <Route path="/endpoints" element={<Endpoints />} />
                <Route path="/settings/system" element={<SystemSettings />} />
                <Route path="*" element={<Navigate to="/agency" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AntdApp>
      </ThemeProvider>
    </AppStoreProvider>
  );
}
