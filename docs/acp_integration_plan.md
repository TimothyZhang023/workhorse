# ACP 接入一期方案

## 什么是 ACP

ACP（Agent Client Protocol）是一个面向「代码编辑器 / 客户端」与「编码 Agent」之间通信的标准协议，目标是把会话、Prompt、工具权限、文件读写、终端执行等能力统一成一套协议。

一期实现里，Workhorse 充当 ACP Client，外部 Agent 充当 ACP Agent。

## 为什么适合接入 Workhorse

- Workhorse 已经有会话、Agency、多 Agent 入口和 MCP 配置中心。
- ACP 把外部 Agent 当成独立执行器，不需要把它们塞进现有 Endpoint 或 MCP 语义里。
- 外部 ACP Agent 可以复用 Workhorse 当前工作区、文件系统、终端能力，以及已配置的 MCP Servers。

## 一期目标

- 在 Agency 中新增一类 `ACP Agent`
- 支持两种预设：
  - `OpenCode` -> 默认命令 `opencode acp`
  - `Claude Code ACP Adapter` -> 默认命令 `npx -y @zed-industries/claude-agent-acp`
- 会话首次发送时创建 ACP session，并把 session id 绑定到 conversation
- 后续同一会话继续走同一个 ACP session
- 自动把 Workhorse 已启用的 MCP Servers 透传给外部 ACP Agent

## 当前实现边界

- 已支持：
  - ACP 初始化、建会话、Prompt、取消
  - 文件读写能力
  - 终端执行能力
  - 工具权限自动放行（优先 allow_once）
  - `session_info_update` 标题回写
  - Agency 页面创建与展示 ACP Agent
- 暂未支持：
  - ACP 会话的编辑后重放 / regenerate
  - 进程重启后的无损会话恢复（取决于外部 Agent 是否支持 resume/load）
  - ACP Agent 的编辑 / 删除 UI（后端已支持删除）

## 后续可演进方向

- 在 Agency 中补 ACP Agent 的测试按钮、状态指示和删除入口
- 支持会话恢复能力检测与自动 resume/load
- 支持更多 ACP 预设
- 把权限策略做成可配置项（allow once / allow always / ask）
