# Workhorse 桌面版深度架构解析

本文档旨在详述 Workhorse 的技术内幕，帮助开发者理解各组件如何在本地协同工作。

## 1. 核心技术栈

- **Runtime**: Node.js 20+ (Sidecar)
- **Desktop Shell**: Tauri 2 (Rust)
- **Frontend**: React 18 + Vite 5 + Ant Design 5
- **Database**: SQLite (`better-sqlite3`)
- **Communication**: HTTP (REST + SSE)

## 2. 进程模型 (Process Model)

Workhorse 启动时会涉及以下进程：

1.  **Main Process (Rust/Tauri)**: 负责窗口管理、系统级集成（菜单、托盘）以及 **Sidecar 进程生命周期管理**。
2.  **Sidecar Process (Node.js)**: 承载整个业务逻辑内核的任务，独立于 UI 运行。
3.  **MCP Worker Processes**: 当调用外部 MCP Server (Stdio) 时，由 Node 进程 fork 出的子进程。

```mermaid
graph LR
    User -->|Interaction| UI[React UI]
    UI -->|API Calls / SSE| Node[Node.js Sidecar]
    subgraph "Sidecar Kernel"
        Node -->|Internal Routing| Controller[Express Routes]
        Controller -->|Logic| AgentEngine[Agent Engine]
        AgentEngine -->|Data| DB[(SQLite)]
        AgentEngine -->|Tooling| MCP[MCP Manager]
    end
    MCP -->|spawn| StdioServer[Local MCP Server]
    MCP -->|fetch| SSEServer[Remote MCP Server]
```

## 3. Node 内核分层职责

### 3.1 Gateway & Auth (Ingress)

- **单机模式鉴权**：在 `server/app.js` 中，系统会通过中间件自动为所有请求注入 `local` 用户上下文，跳过传统登录逻辑。
- **CORS & Proxy**：处理来自前端（通常监听 `12620`）的消息转发至后端（监听 `12621`）。

### 3.2 Agent Kernel (编排内核)

- **Task Resolver**: 解析 `AgentTask` 配置。
- **Context Management**: 见 `server/utils/contextBudget.js`。系统会自动计算消息和工具 Schema 的 Token 消耗。
- **Compression Logic**: `maybeCompactTaskContext` 函数通过 LLM 总结历史，实现"无限长度"对话的假象。
- **Tool Budget**: 防止工具循环调用，同一工具+参数组合调用超过 100 次时强制总结退出。

### 3.3 Execution Layer (驱动层)

- **MCP Router**: 支持统一的工具调用语法，根据工具名自动分发至对应的 MCP Client。支持 Stdio 和 SSE 两种传输协议。
- **Shell Execution**: 使用 `child_process.spawn` 执行本地命令，并具备超时及手动终止 (AbortSignal) 机制。内置 `shell_execute` 工具提供安全的沙箱执行环境。
- **Built-in Tools**: 除 MCP 工具外，还内置 `shell_execute`（本地命令执行）、`ddg-search`（搜索）等工具。

### 3.4 Observability (可观测性)

- **Run IDs**: 每个 Agent 任务运行都有唯一的 ID，关联所有的 `task_run_events`。
- **Unified Logging**: 使用 `pino` 输出结构化日志，方便在开发终端查错。
- **Usage Tracking**: 记录每次模型调用的 Token 消耗，支持按日期、模型维度统计。

### 3.5 Channel Integration (频道集成)

- **Platform Support**: 支持钉钉等平台的 Webhook 集成。
- **Command Trigger**: 通过外部消息触发对应的 AgentTask 执行。
- **Result Callback**: 任务执行完成后自动推送结果至配置频道。

## 4. 关键设计点

### 4.1 模型调度与容错

Workhorse 支持配置多个 Endpoint 候选。在 `server/models/agentEngine.js` 中，系统会根据健康状况自动在重试时切换 Endpoint。

### 4.2 长任务稳定性

Agent 任务通过异步队列运行。即使前端断开连接，Node Sidecar 依然会继续执行任务，并可选地通过钉钉 Webhook 告知用户最终结果。

## 5. 跨平台注意事项

- **Path Handling**: 始终使用 `path.join` 和 `os.homedir` 以兼容 macOS 和 Windows 的文件路径。
## 6. 数据库设计 (Database Schema)

Workhorse 使用 SQLite 存储所有持久化数据。核心数据库 `chat.db` 包含以下关键数据表：

- `conversations`: 存储对话元数据（标题、System Prompt、关联 MCP 工具等）。
- `messages`: 存储对话中的具体消息内容（Role, Content）。
- `folders`: 侧边栏文件夹结构，用于归类对话。

### 6.3 模型与资源
- `endpoint_groups`: 存储模型网关配置（Base URL, API Key, Provider 类型）。
- `models`: 存储从网关同步的具体模型列表及默认生成配置。
- `usage_logs`: 记录每次请求的 Token 消耗、耗时、模型等统计信息。

### 6.4 智能体与自动化
- `skills`: 存储封装好的技能（Prompt + 选定工具），支持通过 Git 或 ZIP 安装。
- `agent_tasks`: 存储预设的 Agent 任务流程。
- `cron_jobs`: 存储定时任务调度策略。
- `task_runs`: 存储任务的执行实例记录。
- `task_run_events`: 存储任务执行过程中的实时事件流日志（如工具调用轨迹）。

### 6.5 系统与集成
- `mcp_servers`: 存储 MCP 服务器配置（Stdio/SSE 地址及认证信息）。
- `channels`: 存储外部推送频道信息（如钉钉 Webhook）。
- `app_settings`: 存储应用全局及用户自定义配置项。

