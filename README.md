# Timo — AI Chat Client

一个基于 OpenAI 兼容接口的私有化 AI 聊天应用，支持多端点配置、多模型切换和对话历史管理。

---

## ✨ 功能特性

- **多 Endpoint 管理**：可在界面中添加、编辑和删除 API Endpoint（Base URL + API Key），支持设置默认端点。
- **多模型切换**：每个 Endpoint 支持自定义模型列表，或使用内置预设模型列表。
- **流式输出**：AI 回复以流式（SSE）方式逐字渲染，支持完整 Markdown 渲染。
- **对话历史与设置**：自动保存所有会话与消息记录，支持修改系统提示词 (System Prompt) 及动态修改标题。
- **消息编辑与重新生成**：支持随时编辑历史消息并截断重新生成后续对话。
- **会话搜索**：侧边栏支持快速本地搜索历史对话。
- **MCP Server 支持**：完整集成 Model Context Protocol (MCP)，支持连接本地（`stdio`）与远程（`sse`）MCP 插件。
- **Function Calling 引擎**：内置支持递归函数调用（Tool Loop），自动将大语言模型与 MCP 插件结合，实现外部工具和数据的自动获取与执行。
- **用户权限 & 用量统计**：提供团队角色 (Admin/User) 分别视图，提供全面用量统计和模型计费估算。
- **平台化网关代理**：内置 `/v1` 兼容 API 代理点，可作为通用网关为其他 AI 开发工具（如 Cursor/Cline）提供统一转发和审计。
- **数据本地化与安全性**：所有数据（用户、会话、API Key、MCP 配置）默认保存在本地 SQLite 数据库，也支持切换 MySQL，敏感信息经过 AES-256 加密，支持 JWT 和 HttpOnly Refresh Token 鉴权。

> 📖 关于该项目的完整演进路线与功能规划，请查看 [产品演进指南](./docs/timo_evolution_spec.md) 与 [架构任务拆解](./docs/project.md)。

---

## 🛠️ 技术栈

| 层级     | 技术                                                                   |
| -------- | ---------------------------------------------------------------------- |
| 前端框架 | [UmiJS (Max)](https://umijs.org/) + React 18                           |
| UI 组件  | [Ant Design 5](https://ant.design/) + Pro Components                   |
| 样式     | Tailwind CSS                                                           |
| 后端     | Node.js + [Express](https://expressjs.com/)                            |
| 数据库   | SQLite / MySQL（默认 SQLite）                                          |
| AI 接入  | [openai SDK](https://github.com/openai/openai-node)（OpenAI 兼容接口） |

---

## 🚀 快速启动

### 前提条件

- Node.js >= 18
- npm >= 9

### 方式一：一键启动（Windows）

```bat
start_all.bat
```

该脚本会自动完成依赖安装、前端构建，并启动服务器。

### 方式二：开发模式

同时启动前端开发服务器和后端服务器（支持热重载）：

```bash
npm install
npm run dev
```

- 前端开发地址：`http://localhost:8000`
- 后端 API 地址：`http://localhost:8866`

### 方式三：生产部署

```bash
npm install
npm run build
npm start
```

构建产物输出到 `dist/` 目录，由 Express 直接托管，访问 `http://localhost:8866`。

---


### 数据库配置（SQLite / MySQL）

默认使用 SQLite（无需额外配置）。如需切换 MySQL，请先安装 `mysql2`（例如 `npm i mysql2`），然后设置以下环境变量：

```bash
DB_CLIENT=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=gemini_chat
```

SQLite 模式下可用 `DB_PATH` 指定数据库文件路径。

## ⚙️ 配置 API

应用启动后，在界面右上角打开**设置**：

1. 点击 **添加 Endpoint**
2. 填写：
   - **名称**：如 `OpenAI` / `Gemini`
   - **Base URL**：如 `https://api.openai.com/v1`
   - **API Key**：你的密钥（`sk-...`）
3. 设置为默认后即可开始聊天

所有配置均加密存储在本地数据库，不会上传至任何服务器。

---

## � Docker 部署

### 前提条件

- 已安装 [Docker](https://www.docker.com/) 和 Docker Compose

### 一键启动（推荐）

```bash
docker compose up -d --build
```

服务启动后访问 `http://localhost:8866`

### 常用命令

```bash
# 查看日志
docker compose logs -f

# 停止服务
docker compose down

# 更新代码后重新构建并启动
docker compose up -d --build

# 查看容器状态
docker compose ps
```

### 数据持久化

所有数据（用户、会话、API Key）保存在 Docker named volume `timo_data` 中：

```bash
# 查看 volume 位置
docker volume inspect timo_data

# 备份数据库
docker cp timo:/app/data/chat.db ./backup_chat.db
```

> **注意**：执行 `docker compose down -v` 会删除 volume 数据，请谨慎操作。

### 修改端口

如需将服务暴露到其他端口（如 80），修改 `docker-compose.yml`：

```yaml
ports:
  - "80:8866"
```

---

```
timo/
├── server/
│   ├── app.js              # Express 应用初始化
│   ├── server.js           # 服务器入口
│   ├── middleware/
│   │   └── auth.js         # Token 鉴权中间件
│   ├── models/
│   │   └── database.js     # SQLite 数据库模型
│   │   └── mcpManager.js   # MCP Server 客户端管理与通信
│   └── routes/
│       ├── auth.js         # 注册/登录接口
│       ├── conversations.js # 会话、流式聊天与 Tool Loop 接口
│       ├── endpoints.js    # Endpoint 管理接口
│       └── mcp.js          # MCP 配置管理接口
├── src/
│   ├── pages/
│   │   ├── Chat/           # 聊天主页面（包含流式渲染、编辑、重生成等）
│   │   └── Login/          # 登录页面
│   ├── components/
│   │   ├── SettingsModal   # 设置弹窗组件
│   │   └── McpModal        # MCP Server 配置组件
│   ├── services/
│   │   └── api.ts          # 前端 API 封装
│   └── models/
│       └── global.ts       # 全局状态管理
├── data/                   # 本地数据库（已 gitignore）
├── dist/                   # 构建输出目录
├── start_all.bat           # Windows 一键启动
├── stop_all.bat            # Windows 停止服务
└── restart_all.bat         # Windows 重启服务
```

---

## 🔒 数据安全说明

- `data/` 目录（含 SQLite 数据库）已加入 `.gitignore`，**不会被提交到代码仓库**。
- `.vscode/` 和 `.claude/` 等编辑器配置同样被排除。
- API Key 仅存储在本地数据库，不会出现在任何代码文件中。

---

## 📄 许可证

MIT License
