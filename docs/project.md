# workhorse 项目设计全景

> 最后更新：2026-03-15  
> 状态：生产就绪 (Production Ready) - 桌面优先架构

## 1. 项目定位与哲学

`workhorse` 旨在成为一个 **"终生学习且本地可控"** 的个人 AI 助手。它不走 SaaS 路线，而是通过 Tauri 提供的底层原生能力，让 AI 能够安全、高效地访问本地资源（文件、Shell、本地网络）。

- **数据主权**：数据流不出个人的电脑（除非主动调用云端模型）。
- **能力拼装**：通过 MCP 接入专业工具，通过 Skills 定义复合能力，通过 Agent Task 编排复杂流程。
- **长效记忆**：基于本地 SQLite 的全量审计与历史追溯。

## 2. 深度架构设计

### 2.1 系统层次

1. **Presentation (Tauri Shell + React)**
   - 采用 Ant Design 5 打造专业、沉稳的 UI 指令中心。
   - 通过 HTTP 通信与底层的 Node Sidecar 交互，未来可扩展至 IPC。
2. **Gateway (Express)**
   - 统一入口。负责鉴权注入（单机模式下默认赋予 `local` 用户 `admin` 权限）。
   - 提供 OpenAI 兼容的代理层，使 Workhorse 能被其他 AI 客户端当作 Provider。
3. **Core Engine (Agent Runtime)**
   - **ReAct 循环**：自主识别工具调用需求并递归执行，直到产出最终结论。
   - **Context Compactor**：当长任务接近 Token 阈值时，自动触发摘要式压缩，保留关键上下文的同时释放槽位。
4. **Integration (MCP & Skills)**
   - **MCP Client**：动态管理 Stdio 和 SSE 服务。
   - **Shell Sandbox**：受限的本地命令执行环境。

### 2.2 数据模型 (Database Schema)

We use **SQLite** with **better-sqlite3** for synchronous, high-performance local storage:

- `users`: 虽然是单机版，仍保留 UID 体系以支持未来的账户导出与云同步。
- `conversations`: 存储会话元数据（标题、系统提示词、绑定的工具集）。
- `messages`: 消息流水。
- `mcp_servers`: 存储外部 MCP 服务的启动参数与配置。
- `skills`: 用户定义的指令库，可绑定特定的 MCP Tool 集合。
- `agent_tasks`: 复杂场景的 Prompt 工程产物，定义了任务的系统提示词与资源范围。
- `cron_jobs`: 定义任务的执行频率（Cron 表达式）。
- `task_runs`: 每一次任务执行的独立审计记录。

## 3. 核心逻辑详解

### 3.1 Agent 执行生命周期

1. **初始化**：加载 Task 配置，混合全局系统提示词 (Global System Prompt)。
2. **推理 (Reasoning)**：调用 LLM 获取思考过程或 Action 请求。
3. **工具执行 (Tooling)**：
   - 检查 Tool 调用预算 (Budget Check)，防止循环死锁。
   - 路由至对应的 MCP Server 或内置工具。
   - 捕获异常并返回给 LLM。
4. **上下文管理**：
   - 监控 Token 指数。
   - 触发 `maybeCompactTaskContext` 进行动态摘要重写。
5. **归档**：将结果持久化，并发送 Webhook 通知（如钉钉）。

### 3.2 安全与隐私

- **敏感词过滤**：本地配置的敏感信息过滤。
- **API Key 加密**：关键配置在存储前通过 `crypto` 模块进行可逆加密。
- **本地审计**：所有 AI 的操作（尤其是 Shell 命令）均有完整的 Input/Output 记录。

## 4. 目录职责分工

```text
server/
   ├── app.js         # 应用初始化与中间件配置
   ├── routes/        # 业务逻辑接口（按领域切分）
   │    ├── conversations.js   # 对话管理与消息处理
   │    ├── agentTasks.js      # Agent任务编排与执行
   │    ├── cronJobs.js        # 定时任务调度管理
   │    ├── mcp.js             # MCP服务器管理
   │    ├── skills.js          # 技能定义与管理
   │    ├── endpoints.js       # 模型端点配置
   │    ├── channels.js        # 频道集成（钉钉等）
   │    ├── channelWebhooks.js # Webhook回调处理
   │    └── system.js          # 系统配置
   ├── models/
   │    ├── database.js        # 数据访问对象与Schema初始化
   │    ├── agentEngine.js     # Agent执行逻辑与ReAct循环
   │    ├── mcpManager.js      # MCP连接池与工具分发
   │    ├── cronRunner.js     # 定时任务执行器
   │    ├── channelRuntime.js # 频道运行时
   │    └── dbClient.js        # 数据库客户端封装
   └── utils/
        ├── contextBudget.js   # Token计算与窗口管理
        ├── modelSelection.js  # 自动根据Endpoint可用性寻找最佳模型
        ├── agentPromptBuilder.js # Agent提示词构建
        ├── mcpGenerator.js    # MCP服务器代码生成
        ├── skillGenerator.js  # Skill自动生成
        ├── crypto.js          # 加密解密工具

src/
   ├── pages/
   │    ├── Chat/             # 对话页面（流式响应、Markdown渲染）
   │    ├── Dashboard/        # 系统概览与统计
   │    ├── AgentTasks/       # Agent任务管理
   │    ├── CronJobs/         # 定时任务配置
   │    ├── Mcp/              # MCP服务器市场与管理
   │    ├── Skills/           # 技能市场与管理
   │    ├── Endpoints/        # 模型端点配置
   │    └── SystemSettings/  # 系统设置
   ├── services/
   │    ├── api.ts            # API请求封装
   │    └── request.ts        # HTTP请求工具
   ├── stores/
   │    └── useAppStore.tsx   # React状态管理
   └── utils/
        └── theme.ts          # 主题配置
```

## 5. 当前限制与挑战

- **并发性**：SQLite 在极高并发写入（如数百个 Cron Jobs 同时运行）时可能面临锁定，目前通过单机队列缓解。
- **Sidecar 体重**：由于集成了 Node 运行时，安装包体积较传统桌面应用偏大。
- **冷启动**：MCP Server 启动耗时依赖于具体工具（如 Docker 型工具耗时较长）。

## 6. 后续演进建议

1. **多模态增强**：进一步优化对本地文件（PDF, CSV, Image）的深度 RAG。
2. **分布式 MCP**：支持连接局域网内其他设备提供的 MCP 接口。
3. **可扩展前端插件**：允许用户自定义 UI 插件来展示特定的工具运行结果（如生成图表）。
