# Timo — 产品系统分析文档 (Project Spec)

> 最后更新：2026-03-03 ｜ 状态：演进中

---

## 一、项目概述

**Timo** 是一款**私有化可部署的全功能 AI 聊天客户端**。定位对标 Open WebUI / LobeChat，但更轻量、更易于二次开发。核心竞争力是：

- **多 Endpoint 聚合**：管理多个大模型 API（OpenAI / Gemini / Claude / 任意兼容接口）
- **本地化部署**：SQLite + Docker，数据全部留在用户自己的服务器
- **扩展性**：开放架构，可持续演进

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | UmiJS (Max) + React 18 |
| UI 组件 | Ant Design 5 + Pro Components |
| 样式 | Tailwind CSS + Vanilla CSS |
| 后端 | Node.js + Express |
| 数据库 | SQLite（better-sqlite3） |
| AI 接入 | openai SDK（OpenAI 兼容接口） |
| 部署 | Docker 多阶段构建 + Compose |

---

## 二、现有功能（已实现）

| 模块 | 功能 | 状态 |
|------|------|------|
| 用户系统 | 注册/登录/登出（PBKDF2 + Token 鉴权）| ✅ |
| 对话管理 | 创建/删除/切换/自动重命名 | ✅ |
| 流式聊天 | SSE 流式输出 + Markdown 渲染 | ✅ |
| Endpoint 管理 | 多 Endpoint 增删改查 + 设置默认 | ✅ |
| 模型管理 | 预设模型列表 + 自定义模型 | ✅ |
| 部署 | Docker + Compose + 量 Volume 持久化 | ✅ |

### 已知技术债

| 问题 | 优先级 |
|------|--------|
| SQLite 不支持并发写入 | 低（单用户可接受） |
| API Key 明文存储（应 AES-256 加密）| 中 |
| Token 非 JWT，无刷新机制 | 中 |
| 零测试覆盖 | 中 |
| 无日志/APM | 低 |
| 硬编码中文字符串（无 i18n）| 低 |

---

## 三、演进路线图

### Phase 1：核心体验增强（当前迭代）

> 所有聊天应用的标配功能，用户感知最强

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 1.1 | 停止生成按钮 | ✅ 完成 | AbortController 中断 SSE |
| 1.2 | 代码语法高亮 + 复制按钮 | ✅ 完成 | react-syntax-highlighter + Prism |
| 1.3 | LaTeX 数学公式渲染 | ✅ 完成 | remark-math + rehype-katex |
| 1.4 | 消息重新生成（Regenerate）| ✅ 完成 | 删除最后 AI 消息并重发 |
| 1.5 | 消息复制 | ✅ 完成 | 单条消息一键复制 |
| 1.6 | 暗色模式 | ✅ 完成 | Ant Design ConfigProvider + CSS var |
| 1.7 | 移动端响应式适配 | ✅ 完成 | 抽屉式 Sider + 底部安全区 |
| 1.8 | 对话手动重命名 | ✅ 完成 | 双击或编辑按钮 |
| 1.9 | 图片上传（Vision）| ✅ 完成 | Base64 内嵌 + GPT-4o/Gemini |
| 1.10 | 键盘快捷键 | ✅ 完成 | Ctrl+N/Ctrl+/ |

### Phase 2：智能增强

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 2.1 | System Prompt 编辑器 | ✅ 完成 | 每个对话可设置系统提示词，含 12 个内置模板 |
| 2.2 | Prompt 模板库 | ✅ 完成 | 内置通用/代码/写作/教学等 12 套模板 |
| 2.3 | 多模型并行对比 | ✅ 完成 | 同一 Prompt 并发发给 2-4 个模型，流式对比 |
| 2.4 | 模型 Fallback | ✅ 完成 | 主 Endpoint 失败自动切换到下一个 |
| 2.5 | RAG 知识库 | 🔲 待开发 | 文档向量化 + 检索增强 |
| 2.6 | 网页抓取 | 🔲 待开发 | 粘贴 URL 自动读取内容 |
| 2.7 | Function Calling / 工具 | 🔲 待开发 | 天气 / 搜索 / 代码执行 |
| 2.8 | 联网搜索 | 🔲 待开发 | Bing/Google Search API |

### Phase 3：平台化能力

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 3.1 | 用户管理 (Team) | ✅ 完成 | Admin 角色、用户列表、权限修改、删除用户 |
| 3.2 | 用量统计面板 | ✅ 完成 | Token 消耗、请求数、活跃天数、分模型费用估算 |
| 3.3 | OpenAI 兼容 API 代理 | ✅ 完成 | /v1 接口，支持 Cursor/Cline 等工具接入 |
| 3.4 | Webhook 通知 | ✅ 完成 | 支持 user.registration 等事件触发 Webhook |
| 3.5 | API Key 管理 | ✅ 完成 | 针对代理接口生成 API Key，统一管理用量 |
| 3.6 | 插件系统 (Artifacts) | ✅ 完成 | HTML 实时预览 (Artifacts)、Markdown 增强渲染 |

### Phase 4：工程卓越（持续）

| # | 功能 | 状态 | 说明 |
|---|------|------|------|
| 4.1 | PostgreSQL 支持 | 🔲 待开发 | 可配置替换 SQLite |
| 4.2 | AES-256 加密 API Key | ✅ 完成 | 存储模型 API Key 前动态加密 |
| 4.3 | JWT + Refresh Token | ✅ 完成 | 移除 Session 表查询，支持跨域 Token 刷新 |
| 4.4 | Rate Limiting | ✅ 完成 | 针对登录与 API 代理实施频率限制 |
| 4.5 | 单元 + E2E 测试 | 🔲 待开发 | Vitest + Playwright |
| 4.6 | CI/CD | 🔲 待开发 | GitHub Actions |
| 4.7 | 结构化日志 | ✅ 完成 | pino + pino-http |
| 4.8 | Sentry 错误监控 | 🔲 待开发 | |
| 4.9 | i18n 国际化 | ⏳ 进行中 | Umi Locale / 中英双语支持 |
| 4.10 | a11y 无障碍 | 🔲 待开发 | ARIA + 键盘导航 |

---

## 四、竞品对标

| 功能 | ChatGPT | Claude | Open WebUI | LobeChat | **Timo 目标** |
|------|---------|--------|------------|----------|--------------|
| 多 Endpoint | ❌ | ❌ | ✅ | ✅ | ✅ |
| 私有化部署 | ❌ | ❌ | ✅ | ✅ | ✅ |
| 图片上传 | ✅ | ✅ | ✅ | ✅ | Phase 1 |
| RAG 知识库 | ✅ | ✅ | ✅ | ✅ | Phase 2 |
| 工具调用 | ✅ | ✅ | ✅ | ✅ | Phase 2 |
| 团队协作 | ✅ | ✅ | ❌ | ❌ | Phase 3 |
| API 代理 | ❌ | ❌ | ✅ | ❌ | Phase 3 |
| 插件系统 | ✅ | ❌ | ✅ | ✅ | Phase 3 |

---

## 五、数据库模型（当前）

```
users          — uid / username / password_hash / salt / role
sessions       — uid / token / expires_at
conversations  — uid / title / system_prompt / created_at / updated_at
messages       — conversation_id / uid / role / content / created_at
endpoint_groups — uid / name / base_url / api_key / is_default / use_preset_models
models         — endpoint_group_id / uid / model_id / display_name
usage_logs     — uid / conversation_id / model / endpoint_name / prompt_tokens / completion_tokens / total_tokens / source / created_at
api_keys       — uid / name / key_prefix / key_hash / is_active / last_used_at / created_at
webhooks       — uid / name / url / secret / events / is_active / created_at
```

## 六、API 路由（当前）

```
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me

GET    /api/conversations
POST   /api/conversations
PUT    /api/conversations/:id
DELETE /api/conversations/:id
GET    /api/conversations/:id/messages
POST   /api/conversations/:id/chat     ← SSE 流式
POST   /api/conversations/:id/regenerate

GET    /api/endpoints
POST   /api/endpoints
PUT    /api/endpoints/:id
DELETE /api/endpoints/:id
PUT    /api/endpoints/:id/default
GET    /api/endpoints/:id/models
POST   /api/endpoints/:id/models
DELETE /api/endpoints/models/:id
GET    /api/endpoints/available/models
GET    /api/endpoints/preset-models

GET    /api/account/summary
GET    /api/account/api-keys
POST   /api/account/api-keys
PUT    /api/account/api-keys/:id/revoke
DELETE /api/account/api-keys/:id
GET    /api/account/webhooks
POST   /api/account/webhooks
DELETE /api/account/webhooks/:id

GET    /api/admin/users
PUT    /api/admin/users/:uid/role
DELETE /api/admin/users/:uid

POST   /v1/chat/completions (OpenAI SDK 兼容代理)
GET    /v1/models
```

---

## 七、技术选型建议

| 需求 | 推荐方案 |
|------|----------|
| 代码高亮 | `react-syntax-highlighter` + Prism |
| LaTeX | `remark-math` + `rehype-katex` |
| 暗色模式 | Ant Design 5 `ConfigProvider` + CSS variables |
| 图片上传 | Ant Design `Upload` + multer + base64 |
| 向量数据库（RAG）| `@xenova/transformers` + hnswlib |
| 代码执行沙箱 | `isolated-vm` |
| i18n | `@umijs/max` 内置 locale |
| JWT | `jsonwebtoken` |
| 速率限制 | `express-rate-limit` |
| 日志 | `pino` |
| E2E 测试 | `playwright` |
