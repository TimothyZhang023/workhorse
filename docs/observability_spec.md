# Workhorse 可观测性与运行审计规格

为了保障 Agent 任务在无人值守（Cron）模式下的可靠性，Workhorse 构建了一套完整的多维可观测性系统。

## 1. 运行审计流 (Task Run Events)

每个任务的执行不仅记录最终结果，还会记录过程中的每一个关键节点：

- **事件类型**:
  - `run_started`: 记录触发源（Manual/Cron/Channel）及注入的 User Message。
  - `turn_started`: 记录模型调用的开始，包含使用的渲染参数。
  - `tool_calls_requested`: 记录模型意图调用的工具名与参数。
  - `tool_completed`: 记录工具执行的耗时、状态码及内容截断后的预览。
  - `tool_error`: 工具执行失败时的错误信息。
  - `context_compacted`: 触发了上下文压缩的事件及结果。
  - `budget_exceeded`: 达到工具调用预算限制时的警告。
  - `final_response`: 任务最终产出的文本结论。

## 2. 状态机管理

任务运行轨迹存储在 `task_runs` 表中，具备以下状态：

- `running`: 正在进行推理或工具执行中。
- `success`: 产出了有效的 Final Response 并正常退出。
- `failed`: 发生网络错误、授权失效或模型崩坏。
- `timed_out`: 工具执行超过了预设的硬超时限制。

## 3. 用量统计 (Usage Analytics)

Workhorse 记录每一次模型调用的 Token 消耗：

- **统计维度**: 按日期、模型名称、端点分组统计
- **指标**: prompt_tokens、completion_tokens、total_tokens
- **用途**: 成本控制、性能分析、模型选择参考

## 4. 监控与告警集成

### 3.1 可视化面板

- **Dashboard**: 提供系统总运行次数、Token 累计消耗、活跃会话数的实时统计。
- **Trace View**: 在聊天中支持查看“运行详情”，将原本枯燥的消息流转换为直观的时间轴视图。

### 3.2 外部通知 (Webhooks)

通过 `Channel` 模块，Workhorse 可以将任务状态实时同步到钉钉、飞书等平台：

- 任务开始执行。
- 任务执行失败（附带 Error Log）。
- 任务成功产出结论。

## 4. 调试最佳实践

- **日志等级**: 生产环境下建议使用 `info`，调试复杂 MCP 工具时可设置 `LOG_LEVEL=debug`。
- **深链追踪**: 通过 `/chat?conversationId={id}` 接口，可以直接定位并分析任何一次异常的运行轨迹。
- **本地还原**: 在开发环境下，可以使用 `server/tests/manual_task.js` 脚本快速回放特定的 AgentTask。
