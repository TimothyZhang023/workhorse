# Agent Task & ReAct 引擎规格说明

Workhorse 的核心价值在于其处理复杂任务的能力。本文档定义了 Agent 任务的运行规格与技术细节。

## 1. 概念模型

- **AgentTask**: 任务的配置模板。包含 System Prompt、启用的工具集 (Tools)、关联的技能 (Skills) 以及首选模型。
- **TaskRun**: 任务的一次具体执行实例。具备独立的状态机 (Running -> Success/Failed)。
- **Skill**: 对一组 Prompt 逻辑和工具的封装，可被多个 Task 复用。

## 2. ReAct 执行流 (Reasoning & Acting)

Engine 遵循循环逻辑，直到任务达成或达到限制：

1.  **构造上下文**:
    - Combined Prompt = Task Prompt + Skill Prompts + Global Markdown.
    - 加载所有可用 MCP Tool 的 JSON Schema。
2.  **模型交互 (Turn N)**:
    - 发送上下文。
    - 模型返回输出：可能是普通的回复文本，也可能是 `tool_calls`。
3.  **Action 处理**:
    - 如果是 `tool_calls`，并行执行所请求的工具。
    - 检查 **Budget**: 同一个工具用同样参数调用超过 N 次（默认 100）时，强制停止并要求模型总结。
4.  **结果反馈**: 将工具输出作为 `role: tool` 消息追加入上下文。
5.  **总结状态**: 如果模型直接给出文本回复且不含工具调用，任务标记为成功并结束。

## 3. 上下文压缩与 Token 预算

为防止长任务导致 Token 溢出（Out of Context），Workhorse 实现了动态压缩：

- **阈值感应**: 每轮循环计算 Token 总量。
- **摘要重写**: 当 Token 使用率超过窗口的 40% (可配置) 时，LLM 会被要求对较早的片段进行摘要。
- **固定锚点**: 最近的 N 条消息始终保持完整。
- **工具预算**: 每个工具调用签名（工具名+参数）默认最多执行 100 次，防止无限循环。

## 4. 内置工具 (Built-in Tools)

除 MCP 工具外，Agent 引擎还内置以下工具：

- **`shell_execute`**: 在沙箱环境中执行本地 Shell 命令。支持超时设置和手动终止。
- **`ddg-search`**: 调用 DuckDuckGo 搜索 API 获取实时信息。

## 5. 任务触发方式

### 4.1 手动触发 (Manual)

由用户在浏览器中通过 `/agent-tasks` 页面点击运行。

### 4.2 定时触发 (Cron)

通过 `node-cron` 实现。任务运行时的上下文会被标记为 `triggerSource: cron`。

### 4.3 命令触发 (Channel Command)

通过外部接口（如钉钉 Webhook）发送命令。系统会通过模糊匹配识别对应的任务名并拉起运行。

## 5. 任务审计与调试

所有的运行细节都会记录在 `task_run_events` 表中，主要类型包括：

- `run_started`: 任务启动及初始参数。
- `turn_started`: 模型调用的开始。
- `tool_calls_requested`: 模型计划使用的工具清单。
- `tool_completed`: 工具执行的具体结果。
- `context_compacted`: 触发了上下文压缩的事件及结果。
- `final_response`: 产出的最终文本结论。

## 6. 开发建议

- **Prompt 隔离**: 尽量将通用的工具操作逻辑写在 Skill 中。
- **幂等性**: 如果任务涉及写入操作（如修改文件），请确保工具实现具备基本的检查逻辑，防止 ReAct 重试导致的重复写入。
