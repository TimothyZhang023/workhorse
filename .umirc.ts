import { defineConfig } from "@umijs/max";

export default defineConfig({
  antd: {},
  access: {},
  model: {},
  initialState: {},
  request: {},
  locale: {
    default: "zh-CN",
    antd: true,
    baseNavigator: true,
  },
  layout: {
    title: "cowhouse (CW)",
  },
  routes: [
    {
      path: "/",
      redirect: "/dashboard",
    },
    {
      name: "Dashboard",
      path: "/dashboard",
      component: "./Dashboard",
      layout: false,
    },
    {
      name: "Login",
      path: "/login",
      component: "./Login",
      layout: false,
    },
    {
      name: "Chat",
      path: "/chat",
      component: "./Chat",
      layout: false,
    },
    {
      name: "AgentTasks",
      path: "/agent-tasks",
      component: "./AgentTasks",
      layout: false,
    },
    {
      name: "Mcp",
      path: "/mcp",
      component: "./Mcp",
      layout: false,
    },
    {
      name: "Skills",
      path: "/skills",
      component: "./Skills",
      layout: false,
    },
    {
      name: "CronJobs",
      path: "/cron-jobs",
      component: "./CronJobs",
      layout: false,
    },
  ],
  npmClient: "npm",
  outputPath: "dist",
  esbuildMinifyIIFE: true,
  proxy: {
    "/api": {
      target: "http://localhost:8080",
      changeOrigin: true,
    },
    "/v1": {
      target: "http://localhost:8080",
      changeOrigin: true,
    },
  },
  tailwindcss: {},
});
