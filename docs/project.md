# cowhouse (CW) 项目说明

> 最后更新：2026-03-14  
> 状态：当前实现已切换为桌面优先架构

## 1. 项目定位

`cowhouse` 是一个本地优先的个人 AI Assistant 工作台。产品目标不是做多租户 SaaS，而是把聊天、工具、技能、任务和调度统一到一台机器上的桌面应用里，强调：

- 本地可控：默认 SQLite，本地 Node sidecar，本地账号上下文
- 模块化扩展：MCP、Skills、Agent Tasks、Cron Jobs 可独立演进
- 工程可维护：Node 侧集中承载模型调度、工具执行和事件落库

## 2. 当前技术架构

### 前端

- Vite 5
- React 18
- React Router 6
- Ant Design 5
- 自定义请求层 `src/services/request.ts`

### 桌面壳

- Tauri 2
- `src-tauri/src/lib.rs` 负责启动 Node sidecar
- 生产桌面版前端通过 `http://127.0.0.1:8080` 访问本地后端

### 后端

- Express API
- `better-sqlite3` 默认存储
- 可选 MySQL
- Pino + pino-http 日志
- OpenAI SDK 兼容模型调用

## 3. 运行模型

当前不是“浏览器登录后再进入工作台”的模型，而是“桌面应用启动后直接进入工作台”的模型：

1. Tauri 启动桌面壳
2. 桌面壳拉起 Node sidecar
3. 后端创建或复用本地用户 `local`
4. 前端默认进入 `/chat`
5. 所有 `/api/*` 路由都运行在本地用户上下文下

这意味着：

- 登录页已经移除
- 传统多用户 Web 部署不再是当前主路径
- 文档、测试和路由都应该围绕 standalone desktop 设计

## 4. 功能模块

### 对话

- 会话管理
- 流式消息输出
- 图片消息
- Markdown / 代码 / 数学公式渲染
- 消息编辑与重新生成
- 会话级工具选择

### 工具与自动化

- MCP Server 管理
- MCP Quickstart 套件
- Skills 模板与批量导入
- Agent Task 编排与运行记录
- Cron Jobs 调度与执行历史
- Channel 扩展与 DingTalk webhook

### 系统能力

- `GET /api/system/overview`
- 全局 System Prompt Markdown
- 本地历史清理接口 `DELETE /api/system/history`
- `/v1/*` OpenAI 兼容代理

## 5. 目录职责

```text
server/      API、模型调度、工具编排、数据库访问
src/         桌面前端 UI
src-tauri/   Tauri 壳、打包配置、sidecar 集成
tests/       后端与请求层回归测试
docs/        产品、架构与迁移文档
```

## 6. 当前已知限制

- 默认实现是单机模式，未保留完整的传统登录流
- 打包依赖本地 sidecar 可执行文件，构建链需要和目标平台一致
- 桌面版前端与后端默认通过本地 HTTP 通信，而不是 Tauri command IPC
- 前端 chunk 体积偏大，`vite build` 仍有大包 warning

## 7. 后续建议

- 补齐 sidecar 打包与版本产物的自动化脚本
- 把桌面构建、前端构建和 sidecar 校验接入 CI
- 进一步拆分前端大包，降低首屏加载体积
- 明确是否长期放弃多用户 Web 模式，避免文档和代码再次分叉
