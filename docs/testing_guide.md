# Workhorse 测试与校验指南

本文档指导开发者与测试人员如何对 Workhorse 进行功能验证与端到端测试。

## 1. 核心链路测试

### 1.1 对话系统

- **流式输出验证**: 确认 `render-markdown` 是否正确解析即时返回的文本流。
- **代码高亮**: 发送包含 Python, JS, SQL 的代码块，检查 `prism-js` 的染色效果。
- **上下文连续性**: 连续发送 3 次相关问题，确认 Agent 能够正确引用前文。
- **重试与再生**: 测试消息再生功能，确认上下文连贯。

### 1.2 Agent 任务 (Agent Tasks)

- **ReAct 循环检查**: 启动一个需要调用工具的任务，观察控制台日志，确认模型是否正确发出了 `tool_calls`。
- **预算约束**: 故意制造一个会导致工具重复调用的场景，验证 `agentEngine` 是否在大约 100 次重复后强制总结并退出。
- **并发执行**: 同时手动触发 3 个不同的 AgentTask，确认 SQLite 不会因为忙碌而导致进程崩溃。
- **任务生成**: 测试 AI 自动生成 AgentTask Prompt 的能力。

### 1.3 MCP 插件生态

- **Stdio Transport**: 配合本地 Python 环境测试 `mcp-server-postgres` 或类似的本地工具。
- **SSE Transport**: 测试连接至远程提供的 MCP 接口，验证鉴权 Headers 是否带入。
- **热加载**: 在设置中修改 MCP 环境变量后，确认下次执行工具时已生效。
- **MCP 市场**: 测试从默认模板和社区市场导入 MCP 服务器。
- **批量操作**: 测试 MCP 服务器的批量启用/禁用/删除。

### 1.4 Skills 技能系统

- **技能创建**: 测试手动创建 Skill 并关联 MCP 工具。
- **Git 安装**: 测试从 Git 仓库安装 Skill。
- **技能生成**: 测试 AI 自动生成 Skill Prompt 的能力。

## 2. 定时任务 (Cron Jobs)

- **调度准确性**: 设置一个分钟级的 Cron，确认任务能够在预定时间准时拉起。
- **重叠保护**: 设置一个耗时很长的任务，并将 Cron 频率设得极高，验证 `CronRunner` 是否成功跳过了重叠的请求。
- **状态回更**: 任务结束后，确认数据库中的 `last_run` 和 `last_status` 字段能够即时更新。
- **历史追溯**: 查看历史运行记录，确认事件链完整。

## 3. 端点与模型

- **多端点配置**: 配置多个不同的模型端点，验证自动切换能力。
- **模型同步**: 测试从远程同步可用模型列表。
- **API Key 管理**: 测试 API Key 的加密存储和安全调用。

## 4. 频道集成

- **Webhook 配置**: 配置钉钉 Webhook 并测试消息回调。
- **命令触发**: 通过模拟外部请求触发 AgentTask 执行。

## 5. 部署与打包验证

- **Sidecar 校验**: 构建完成后，检查 `src-tauri/sidecar/` 目录下是否存在对应平台的 Node 二进制文件。
- **单机模式鉴权**: 启动包后，确认不需要登录即可直接进入 `/chat`，且 `localStorage` 中的用户 ID 为 `local`。
- **跨平台路径**: 验证 macOS 和 Windows 下的路径处理正确性。

## 6. 自动化测试 (Vitest)

项目包含基于 Vitest 的 API 单元测试，运行以下命令进行快速验证：

```bash
# 运行所有测试
npm test

# 监听模式（开发时）
npm run test:watch

# CI 模式（无覆盖率）
npm run test:ci
```

测试覆盖范围：

- `conversations-stop.test.js`: 对话停止功能
- `conversations-tools.test.js`: 工具调用功能
- `conversations-regenerate.test.js`: 消息再生功能
- `mcp-manager-shell.test.js`: MCP Shell 工具
- `mcp-batch.test.js`: MCP 批量操作
- `database-models.test.js`: 数据库模型
- `system-config.test.js`: 系统配置
- `theme-utils.test.ts`: 主题工具
- `request-utils.test.ts`: 请求工具

> [!NOTE]
> 测试环境默认使用独立的内存数据库或 `.test.db` 文件，不会影响您的本地生产数据。
