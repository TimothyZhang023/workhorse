import {
  BarChartOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  MoonOutlined,
  RobotOutlined,
  ScheduleOutlined,
  SettingOutlined,
  SunOutlined,
  ThunderboltOutlined,
  ApiOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { Button } from "antd";
import React from "react";
import "./Sidebar.css";

export interface SidebarProps {
  moduleExpanded: boolean;
  setModuleExpanded: (expanded: boolean) => void;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  activePath: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  moduleExpanded,
  setModuleExpanded,
  theme,
  setTheme,
  activePath,
}) => {
  const navigate = useNavigate();

  const navItems = [
    {
      key: "dashboard",
      path: "/dashboard",
      icon: <HomeOutlined />,
      label: "Dashboard",
    },
    { key: "chat", path: "/chat", icon: <MessageOutlined />, label: "对话" },
    { type: "divider", label: "Agent 助手" },
    {
      key: "mcp",
      path: "/mcp",
      icon: <ApiOutlined />,
      label: "MCP 管理",
    },
    {
      key: "skills",
      path: "/skills",
      icon: <ThunderboltOutlined />,
      label: "技能管理",
    },
    {
      key: "agent-tasks",
      path: "/agent-tasks",
      icon: <RobotOutlined />,
      label: "任务编排",
    },
    {
      key: "cron-jobs",
      path: "/cron-jobs",
      icon: <ScheduleOutlined />,
      label: "定时调度",
    },
  ];

  return (
    <aside
      className={`cw-dashboard-sider ${
        moduleExpanded ? "expanded" : "collapsed"
      }`}
    >
      <div className="cw-sider-top">
        <div className="cw-sider-brand-row">
          <div className="cw-sider-badge">CW</div>
          {moduleExpanded && (
            <span className="cw-sider-brand-text">cowhouse</span>
          )}
          <Button
            type="text"
            icon={
              moduleExpanded ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />
            }
            className="cw-sider-toggle"
            onClick={() => setModuleExpanded(!moduleExpanded)}
          />
        </div>

        {navItems.map((item, idx) => {
          if (item.type === "divider") {
            return moduleExpanded ? (
              <div key={idx} className="cw-sider-divider-text">
                {item.label}
              </div>
            ) : (
              <div
                key={idx}
                style={{
                  height: 1,
                  background: "rgba(148,163,184,0.1)",
                  margin: "8px 4px",
                }}
              />
            );
          }

          const isActive = activePath === item.path;
          return (
            <Button
              key={item.key}
              type="text"
              icon={item.icon}
              className={`cw-sider-btn ${
                isActive ? "cw-sider-btn-active" : ""
              }`}
              onClick={() => navigate(item.path!)}
            >
              {moduleExpanded && <span>{item.label}</span>}
            </Button>
          );
        })}
      </div>

      <div className="cw-sider-bottom">
        <Button
          type="text"
          icon={theme === "dark" ? <SunOutlined /> : <MoonOutlined />}
          className="cw-sider-btn"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {moduleExpanded && (
            <span>{theme === "dark" ? "浅色模式" : "深色模式"}</span>
          )}
        </Button>
      </div>
    </aside>
  );
};
