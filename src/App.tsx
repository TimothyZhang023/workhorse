import React, { Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppStoreProvider } from "@/stores/useAppStore";
import { ThemeProvider } from "@/contexts/ThemeContext";

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
        <BrowserRouter>
          <Suspense
            fallback={
              <div className="p-8 text-center text-gray-500 mt-20">
                加载中...
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
      </ThemeProvider>
    </AppStoreProvider>
  );
}
