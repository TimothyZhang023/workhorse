# cowhouse (CW)

一个本地优先的个人 AI Assistant 工作台。当前主形态已经从传统 Web 项目切到 `Vite + React + Tauri + Node sidecar`，默认面向单机桌面场景：前端是桌面壳，后端是本地 Node 服务，数据默认落在 SQLite。

相关文档：

- [产品演进说明](docs/cw_evolution_spec.md)
- [项目分析文档](docs/project.md)
- [桌面版升级结果](docs/cw_upgrade_spec.md)
- [Mac 架构说明](docs/mac_openclaw_architecture.md)

## 当前形态

- 桌面壳：Tauri 2
- 前端：Vite + React 18 + React Router + Ant Design 5
- 后端：Node.js + Express
- 数据库：SQLite（默认）/ MySQL（可选）
- 模型接入：OpenAI Compatible / OpenAI / Gemini / OpenRouter
- 工具能力：MCP、Skills、Agent Tasks、Cron Jobs、Channel 扩展
- 对外接口：`/v1/*` OpenAI 兼容代理

## 主要能力

- 对话页支持流式输出、Markdown、代码高亮、数学公式、图片上传、消息编辑与重新生成
- 支持 Endpoint、模型、MCP Server、Skill、Agent Task、Cron Job 的完整管理
- 支持 MCP Quickstart、Skills 模板、批量导入/校验
- 支持系统概览与全局 System Prompt Markdown 配置
- 默认以本地用户 `local` 运行，不再依赖登录页

## 目录结构

```text
.
├── server.js                  # Node sidecar 入口
├── server/                    # Express API 与运行时核心
├── src/                       # Vite + React 前端
├── src-tauri/                 # Tauri 壳、sidecar 配置与打包
├── tests/                     # Vitest + Supertest
├── docs/                      # 说明文档
├── data/                      # 默认 SQLite 数据目录
└── dist/                      # 前端构建产物
```

## 运行要求

- Node.js `>= 20`
- npm `>= 10`
- Rust toolchain（仅桌面版构建需要）
- Xcode Command Line Tools（macOS 打包需要）

## 开发

安装依赖：

```bash
npm install
```

启动 Web 开发模式：

```bash
npm run dev
```

默认会同时启动：

- 前端开发服务：`http://localhost:5173`
- 本地 API 服务：`http://127.0.0.1:8080`

启动桌面开发模式：

```bash
npm run dev:tauri
```

## 构建

构建前端：

```bash
npm run build:frontend
```

构建桌面版：

```bash
npm run build:tauri
```

macOS 下默认产物位置：

- `src-tauri/target/release/bundle/macos/cowhouse.app`

如果只想单独启动后端 sidecar：

```bash
npm start
```

## 测试与校验

```bash
npm test
npx tsc --noEmit
npm run build:frontend
```

## 路由与接口

页面路由：

- `/` 自动跳转到 `/chat`
- `/dashboard`
- `/chat`
- `/mcp`
- `/skills`
- `/agent-tasks`
- `/cron-jobs`

核心接口：

- `GET /health`
- `GET /api/system/overview`
- `GET /api/system/settings/global-system-prompt`
- `PUT /api/system/settings/global-system-prompt`
- `DELETE /api/system/history`
- `/api/*` 业务接口
- `/v1/*` OpenAI 兼容代理

## 环境变量

### 运行时

| 变量                      | 默认值 | 说明                  |
| ------------------------- | ------ | --------------------- |
| `PORT`                    | `8080` | Node sidecar 监听端口 |
| `LOG_LEVEL`               | `info` | Pino 日志级别         |
| `GLOBAL_SYSTEM_PROMPT_MD` | 空     | 全局系统提示词默认值  |

### 数据库

| 变量          | 默认值         | 说明                    |
| ------------- | -------------- | ----------------------- |
| `DB_CLIENT`   | `sqlite`       | 支持 `sqlite` / `mysql` |
| `DB_PATH`     | `data/chat.db` | SQLite 文件路径         |
| `DB_HOST`     | `127.0.0.1`    | MySQL 主机              |
| `DB_PORT`     | `3306`         | MySQL 端口              |
| `DB_USER`     | `root`         | MySQL 用户              |
| `DB_PASSWORD` | 空             | MySQL 密码              |
| `DB_NAME`     | `gemini_chat`  | MySQL 库名              |

### 前端

| 变量                | 默认值 | 说明                                 |
| ------------------- | ------ | ------------------------------------ |
| `VITE_API_BASE_URL` | 空     | 仅在需要覆盖桌面端默认后端地址时使用 |

## 当前约束

- 当前实现默认是单机桌面模式，鉴权上下文会注入本地用户 `local`
- `src-tauri/sidecar/` 需要存在可执行 sidecar，Tauri 打包时会一并带入
- 生产桌面版前端请求默认走 `http://127.0.0.1:8080`
