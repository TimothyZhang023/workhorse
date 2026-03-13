# cowhouse (CW)

一个面向个人与小团队的私有化 AI Assistant 工作台。项目提供完整的聊天 UI、Endpoint 与模型管理、MCP 工具接入能力，以及一层 OpenAI 兼容的统一 `/v1` 代理，方便把外部工具统一接到你自己的模型网关上。

当前仓库已经包含前端、后端、数据库初始化、测试和 Docker 部署配置，开箱即可本地运行。

相关文档：

- [产品演进说明](docs/cw_evolution_spec.md)
- [项目分析文档](docs/project.md)
- [升级设计说明](docs/cw_upgrade_spec.md)

## 项目定位

如果你希望有一个可以自己部署、自己掌控数据、并且能统一管理多个模型供应商的 AI 工作台，这个项目就是为这个场景设计的。

它的核心目标是：

- 统一管理多个大模型 Endpoint
- 提供接近现成产品的聊天体验
- 支持本地数据存储和私有化部署
- 提供兼容 OpenAI 的 `/v1` API，便于第三方工具复用
- 保持代码结构简单，便于二次开发

## 当前能力

### 前端体验

- Dashboard 首页与基础用量展示
- 登录页、会话页、聊天页完整流程
- 流式聊天输出
- Markdown 渲染
- 代码高亮
- 数学公式渲染
- 图片上传消息
- 消息编辑与重新生成
- 会话搜索、重命名、删除
- System Prompt 配置
- 深色模式
- 中英文本地化基础支持
- 移动端适配

### 模型与连接管理

- 支持配置多个 Endpoint
- 支持 OpenAI / OpenAI Compatible / OpenRouter / Gemini 兼容地址
- 支持默认 Endpoint
- 支持模型列表同步与手动维护
- 支持统一的 OpenAI 兼容代理 `/v1/*`
- 支持通过 cowhouse 自己签发的 API Key 对外提供代理服务

### 扩展能力

- 支持 MCP Server 管理
- 支持本地 `stdio` 类型 MCP
- 支持远程 `sse` 类型 MCP
- 支持 Agent Skills 管理与任务挂载
- 支持 Channel 扩展安装（DingTalk/WeCom/Telegram/Discord）


### 安装与可用性增强（新增）

- Skills 模板：`GET /api/skills/templates`、`POST /api/skills/templates/:templateId/install`
- Skills 批量导入与校验：`POST /api/skills/import`、`POST /api/skills/validate`
- MCP Quickstart：`GET /api/mcp/quickstart/bundles`、`POST /api/mcp/quickstart/install`
- MCP 配置校验：`POST /api/mcp/validate`
- 系统概览：`GET /api/system/overview`
- 全局系统提示词 Markdown 配置：`GET /api/system/settings/global-system-prompt`、`PUT /api/system/settings/global-system-prompt`
- DingTalk 公共 webhook：`POST /api/channel-webhooks/dingtalk/:channelId`

### 后端与安全基础

- JWT Access Token + Refresh Token
- 默认支持单机模式（`STANDALONE_MODE=true`）免登录运行
- API 速率限制
- Pino 日志
- SQLite 默认存储
- 可切换到 MySQL

## 单机模式（Desktop / Local-first）

- 默认 `STANDALONE_MODE=true`，服务会自动创建本地用户 `local` 并注入鉴权上下文。
- 若需要恢复传统多用户登录流程，可设置 `STANDALONE_MODE=false`。
- Channel 扩展 API：
  - `GET /api/channels/extensions`
  - `POST /api/channels/extensions/:platform/install`

## 技术栈

| 层级   | 技术                          |
| ------ | ----------------------------- |
| 前端   | Umi Max + React 18            |
| UI     | Ant Design 5 + Pro Components |
| 后端   | Node.js + Express             |
| 数据库 | SQLite / MySQL                |
| AI SDK | OpenAI Node SDK               |
| MCP    | `@modelcontextprotocol/sdk`   |
| 样式   | Tailwind CSS + 自定义 CSS     |
| 测试   | Vitest + Supertest            |
| 日志   | Pino + pino-http              |
| 部署   | Docker + Docker Compose       |

## 仓库结构

```text
.
├── server.js                  # 服务入口
├── server/                    # Express 后端
│   ├── app.js                 # 应用装配、路由、静态资源与代理
│   ├── middleware/            # 鉴权与权限中间件
│   ├── models/                # 数据访问、MCP 连接管理
│   ├── routes/                # API 路由
│   └── utils/                 # JWT、加密、日志等
├── src/                       # Umi + React 前端
│   ├── components/            # 复用组件
│   ├── contexts/              # Theme 等上下文
│   ├── locales/               # i18n 文案
│   ├── models/                # 前端全局状态
│   ├── pages/                 # Dashboard / Chat / Login
│   └── services/              # 前端 API 请求封装
├── tests/                     # 后端与核心逻辑测试
├── docs/                      # 产品与架构文档
├── data/                      # SQLite 数据文件目录
├── dist/                      # 前端构建产物
├── Dockerfile
└── docker-compose.yml
```

说明：

- `src/.umi` 与 `src/.umi-production` 为 Umi 生成文件，不建议手改
- `data/` 默认保存本地 SQLite 数据
- 生产模式下由 Express 直接托管 `dist/`

## 运行要求

- Node.js `>= 18`
- npm `>= 9`

如果使用 Docker，则只需安装 Docker 与 Docker Compose。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 开发模式启动

```bash
npm run dev
```

默认会同时启动：

- 前端开发服务：`http://localhost:8000`
- 后端 API 服务：`http://localhost:8080`

开发模式下，前端通过 Umi proxy 将 `/api` 和 `/v1` 请求转发到后端。

### 3. 生产模式启动

```bash
npm run build
npm run start
```

或直接：

```bash
npm run start:prod
```

生产模式下：

- 仅监听一个端口，默认 `8000`
- Express 同时提供前端静态资源和后端接口

访问地址：

- `http://localhost:8000`

### 4. 常用命令

```bash
npm run dev
npm run build
npm run start
npm run start:prod
npm run stop
npm run restart
npm run restart:prod
npm run test
npm run test:watch
npm run test:ci
npm run format
```

## 页面与接口入口

### 页面路由

- `/` 自动跳转到 `/dashboard`
- `/dashboard`
- `/chat`
- `/login`

### 系统接口

- `GET /health` 健康检查
- `/api/*` 业务接口
- `/v1/*` OpenAI 兼容代理接口

## 环境变量

项目没有强制要求 `.env` 文件，但服务端会读取以下环境变量。未配置时会使用内置默认值。

### 服务与运行时

| 变量               | 默认值          | 说明                                           |
| ------------------ | --------------- | ---------------------------------------------- |
| `PORT`             | `8000`          | 服务监听端口                                   |
| `NODE_ENV`         | 非 `production` | 运行模式                                       |
| `LOG_LEVEL`        | `info`          | Pino 日志级别                                  |
| `FRONTEND_DEV_URL` | 空              | 单端口开发代理时使用，未设置则直接托管 `dist/` |

### 数据库

| 变量           | 默认值         | 说明                                |
| -------------- | -------------- | ----------------------------------- |
| `DB_CLIENT`    | `sqlite`       | 数据库类型，支持 `sqlite` / `mysql` |
| `DB_PATH`      | `data/chat.db` | SQLite 数据库文件路径               |
| `DB_HOST`      | `127.0.0.1`    | MySQL 主机                          |
| `DB_PORT`      | `3306`         | MySQL 端口                          |
| `DB_USER`      | `root`         | MySQL 用户名                        |
| `DB_PASSWORD`  | 空             | MySQL 密码                          |
| `DB_NAME`      | `gemini_chat`  | MySQL 数据库名                      |
| `DB_POOL_SIZE` | `10`           | MySQL 连接池大小                    |

### 鉴权与加密

| 变量             | 默认值     | 说明                                   |
| ---------------- | ---------- | -------------------------------------- |
| `JWT_SECRET`     | 内置默认值 | Access Token 签名密钥                  |
| `REFRESH_SECRET` | 内置默认值 | Refresh Token 签名密钥                 |
| `ENCRYPTION_KEY` | 内置默认值 | API Key 等敏感信息加密密钥，要求 32 位 |

建议：

- 生产环境务必覆盖 `JWT_SECRET`、`REFRESH_SECRET`、`ENCRYPTION_KEY`
- 不要直接使用仓库中的默认密钥

## 数据库说明

### SQLite

默认无需额外配置，启动后会自动在 `data/` 下创建数据库文件。

### MySQL

如需切换 MySQL，需要先安装依赖：

```bash
npm install mysql2
```

然后设置环境变量：

```bash
DB_CLIENT=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=cowhouse
DB_POOL_SIZE=10
```

说明：

- 项目运行时会根据 `DB_CLIENT` 自动选择数据库客户端
- MySQL 模式适合后续多用户或更高并发场景
- 单用户本地部署优先推荐 SQLite，部署成本更低

## Endpoint 与模型配置

启动后，在界面的设置相关入口中配置上游模型 Endpoint。

基本流程：

1. 添加 Endpoint
2. 填写名称、Base URL、API Key
3. 选择是否设为默认 Endpoint
4. 同步模型列表，或手动维护可用模型

常见 Base URL 示例：

- OpenAI: `https://api.openai.com/v1`
- Gemini OpenAI Compatible: `https://generativelanguage.googleapis.com/v1beta/openai`
- OpenRouter: `https://openrouter.ai/api/v1`

设计说明：

- 聊天与 `/v1` 代理都依赖你在 cowhouse 中配置的 Endpoint
- `/v1/models` 会优先基于默认 Endpoint 的模型配置返回列表
- `/v1/chat/completions` 会按默认优先的顺序尝试可用 Endpoint，并在失败时回退

## OpenAI 兼容代理

仓库内置统一代理层，适合把 Cursor、Cline、脚本、内部工具统一接入 cowhouse。

### 代理地址

```text
http://your-host:8000/v1
```

### 已支持接口

- `GET /v1/models`
- `POST /v1/chat/completions`

### 鉴权方式

使用 cowhouse 平台内创建的 API Key：

```text
Authorization: Bearer <your-cowhouse-api-key>
```

### 使用示例

```bash
curl http://localhost:8000/v1/models \
  -H "Authorization: Bearer YOUR_COWHOUSE_API_KEY"
```

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_COWHOUSE_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      { "role": "user", "content": "hello" }
    ],
    "stream": false
  }'
```

特性说明：

- 兼容 OpenAI 风格请求体
- 支持流式和非流式返回
- 自动记录调用用量
- 响应头会返回实际命中的 Endpoint 信息

## MCP 集成

项目已内置 MCP Server 管理能力。

当前支持：

- `stdio`
- `sse`

服务端接口位于：

- `GET /api/mcp`
- `POST /api/mcp`
- `PUT /api/mcp/:id`
- `DELETE /api/mcp/:id`

典型用途：

- 挂接本地命令型工具
- 挂接远程工具服务
- 为聊天过程引入外部能力扩展

## Docker 部署

### 使用 Compose

```bash
docker compose up -d --build
```

默认访问地址：

- `http://localhost:8000`

### 常用命令

```bash
docker compose ps
docker compose logs -f
docker compose down
docker compose up -d --build
```

### 持久化

Compose 默认会挂载命名卷：

- `cowhouse_data:/app/data`

这意味着 SQLite 数据、账号信息和系统配置可以持久保留。

### 自定义端口

如需修改外部访问端口，调整 [docker-compose.yml](docker-compose.yml) 中的 `ports` 配置即可。

## 测试

运行全部测试：

```bash
npm test
```

持续观察模式：

```bash
npm run test:watch
```

CI 模式：

```bash
npm run test:ci
```

当前仓库已包含的测试覆盖主要集中在：

- 认证接口
- 会话重新生成逻辑
- 加密工具
- 数据库客户端
- 代理能力

## 开发说明

### 前后端关系

- 前端代码位于 `src/`
- 后端代码位于 `server/`
- 开发模式下前后端分端口
- 生产模式下由 Express 托管前端构建产物

### 构建产物

- `dist/` 为前端构建结果
- `public/` 中存在静态产物与资源

### 生成文件

以下目录一般不建议手工修改：

- `src/.umi`
- `src/.umi-production`
- `dist/`

## 安全建议

- 生产环境修改默认 JWT 与加密密钥
- 反向代理到公网时建议配合 HTTPS
- 不要把真实上游 API Key 提交到仓库
- 定期备份 `data/` 或你的 MySQL 数据库
- 对外开放 `/v1` 时，务必使用 cowhouse API Key 进行隔离

## 已知边界

- SQLite 更适合单机或轻量场景
- 当前文档与产品 spec 中存在“已实现”和“规划中”并存的内容，开发时请以实际代码为准
- 某些高级能力仍在持续演进中，详情可参考 `docs/`

## License

MIT


## CI / 打包

仓库新增 GitHub Actions：`.github/workflows/ci.yml`，默认执行安装、测试、构建并上传 `dist` 打包产物。部署密钥预留在 `.github/DEPLOY_KEYS.md`。
