import {
  DesktopOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuOutlined,
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
import { Button, Dropdown, Drawer } from "antd";
import React, { useState } from "react";
import { Theme, ThemeMode } from "@/utils/theme";
import "./Sidebar.css";

export interface SidebarProps {
  moduleExpanded: boolean;
  setModuleExpanded: (expanded: boolean) => void;
  themeMode: ThemeMode;
  resolvedTheme: Theme;
  setThemeMode: (themeMode: ThemeMode) => void;
  activePath: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  moduleExpanded,
  setModuleExpanded,
  themeMode,
  resolvedTheme,
  setThemeMode,
  activePath,
}) => {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    {
      key: "dashboard",
      path: "/dashboard",
      icon: <HomeOutlined />,
      label: "Dashboard",
    },
    {
      key: "chat",
      path: "/agency",
      icon: <MessageOutlined />,
      label: "Agency",
    },
    { type: "divider", label: "核心配置" },
    {
      key: "endpoints",
      path: "/endpoints",
      icon: <ApiOutlined />,
      label: "LLM 端点",
    },
    {
      key: "system-settings",
      path: "/settings/system",
      icon: <SettingOutlined />,
      label: "全局系统配置",
    },
    { type: "divider", label: "Agent 助手" },
    {
      key: "mcp",
      path: "/mcp",
      icon: <DesktopOutlined />,
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

  const themeLabel =
    themeMode === "system"
      ? "跟随系统"
      : resolvedTheme === "dark"
        ? "深色模式"
        : "浅色模式";
  const themeIcon =
    themeMode === "system" ? (
      <DesktopOutlined />
    ) : resolvedTheme === "dark" ? (
      <MoonOutlined />
    ) : (
      <SunOutlined />
    );

  const menuContent = (
    <div className="cw-sidebar-menu-content">
      {navItems.map((item, idx) => {
        if (item.type === "divider") {
          return (
            <div key={idx} className="cw-sider-divider-text">
              {item.label}
            </div>
          );
        }

        const isActive = activePath === item.path;
        return (
          <Button
            key={item.key}
            type="text"
            icon={item.icon}
            className={`cw-sider-btn ${isActive ? "cw-sider-btn-active" : ""
              }`}
            onClick={() => {
              navigate(item.path!);
              setMobileMenuOpen(false);
            }}
          >
            <span>{item.label}</span>
          </Button>
        );
      })}
    </div>
  );

  return (
    <>
      <aside
        className={`cw-dashboard-sider ${moduleExpanded ? "expanded" : "collapsed"
          }`}
      >
        <div className="cw-sider-top">
          <div className="cw-sider-brand-row">
            <div className="cw-sider-badge">WH</div>
            {moduleExpanded && (
              <span className="cw-sider-brand-text">workhorse</span>
            )}
            <Button
              type="text"
              icon={
                moduleExpanded ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />
              }
              className="cw-sider-toggle"
              onClick={() => setModuleExpanded(!moduleExpanded)}
            />
            <div className="cw-mobile-header-actions" style={{ marginLeft: 'auto', display: 'none' }}>
              <Button
                type="text"
                icon={<MenuOutlined />}
                className="cw-sider-btn-mobile-trigger"
                onClick={() => setMobileMenuOpen(true)}
              />
            </div>
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
                    margin: "12px 4px",
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
                className={`cw-sider-btn ${isActive ? "cw-sider-btn-active" : ""
                  }`}
                onClick={() => navigate(item.path!)}
              >
                {moduleExpanded && <span>{item.label}</span>}
              </Button>
            );
          })}
        </div>

        <div className="cw-sider-bottom">
          <Dropdown
            trigger={["click"]}
            menu={{
              selectable: true,
              selectedKeys: [themeMode],
              items: [
                { key: "system", icon: <DesktopOutlined />, label: "跟随系统" },
                { key: "light", icon: <SunOutlined />, label: "浅色模式" },
                { key: "dark", icon: <MoonOutlined />, label: "深色模式" },
              ],
              onClick: ({ key }) => setThemeMode(key as ThemeMode),
            }}
          >
            <Button type="text" icon={themeIcon} className="cw-sider-btn">
              {moduleExpanded && <span>{themeLabel}</span>}
            </Button>
          </Dropdown>
        </div>
      </aside>

      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="cw-sider-badge">WH</div>
            <span style={{ fontWeight: 600 }}>workhorse</span>
          </div>
        }
        placement="left"
        onClose={() => setMobileMenuOpen(false)}
        open={mobileMenuOpen}
        width={280}
        styles={{
          body: { padding: "12px 10px" },
          header: { borderBottom: '1px solid rgba(0,0,0,0.05)' }
        }}
        closeIcon={<MenuFoldOutlined />}
      >
        {menuContent}
        <div style={{ marginTop: 'auto', padding: '20px 0 10px' }}>
          <Dropdown
            trigger={["click"]}
            menu={{
              selectable: true,
              selectedKeys: [themeMode],
              items: [
                { key: "system", icon: <DesktopOutlined />, label: "跟随系统" },
                { key: "light", icon: <SunOutlined />, label: "浅色模式" },
                { key: "dark", icon: <MoonOutlined />, label: "深色模式" },
              ],
              onClick: ({ key }) => setThemeMode(key as ThemeMode),
            }}
          >
            <Button type="text" icon={themeIcon} className="cw-sider-btn" style={{ width: '100%', justifyContent: 'flex-start' }}>
              <span>{themeLabel}</span>
            </Button>
          </Dropdown>
        </div>
      </Drawer>
    </>
  );
};
