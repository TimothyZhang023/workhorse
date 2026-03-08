# Cowhorse (CW) Upgrade Spec

## 1. Goal

把当前单一 Chat Web 升级为个人助理 Agent 产品 **cowhouse (CW)**：

- 首页改为 **Dashboard**（产品入口，不直接进聊天）
- 左侧改为 **功能模块导航**（非会话列表）
- `对话` 作为一个模块，模块内再展示会话数据
- 对话列表从左侧迁移到聊天页右侧面板

## 2. Information Architecture

- `/dashboard`
  - 产品总览（欢迎语、模块入口卡片、快捷操作）
- `/chat`
  - 模块名：`对话`
  - 页面结构：
    - 左：模块导航（Dashboard / 对话）
    - 中：消息流 + 输入区
    - 右：会话列表（搜索、新建、重命名、删除）

## 3. Routing & Auth Rules

- 根路由 `/` 重定向到 `/dashboard`
- 登录成功后跳转 `/dashboard`
- 已登录访问 `/login` 自动跳转 `/dashboard`
- 未登录访问受保护页面仍跳转 `/login`

## 4. Chat Module Layout Spec

- 左侧模块导航（固定窄栏）
  - 品牌：`CW`
  - 模块入口：
    - `Dashboard`（跳转 `/dashboard`）
    - `对话`（当前页高亮）
  - 底部保留：主题切换、账户、设置、退出登录
- 中间聊天主区
  - 头部：模块标题 + 当前用户
  - 内容：消息列表
  - 底部：输入框、模型选择、参数、发送
- 右侧会话面板
  - 搜索
  - 新建会话
  - 会话项（选择/重命名/删除）

## 5. Mobile Behavior

- 左侧模块导航改为左抽屉
- 会话列表改为右抽屉
- 聊天主区保持全宽

## 6. Data & Backward Compatibility

- 会话、消息、模型、系统提示词、参数逻辑不变
- API 与数据库 schema 不改
- 仅调整前端路由和布局结构

## 7. Phased Implementation

1. 新增 Dashboard 页面与样式
2. 路由与登录跳转迁移到 `/dashboard`
3. Chat 页面重构为三栏（桌面）+ 双抽屉（移动）
4. 样式重构：移除“左侧会话列表”耦合样式，补充模块导航与右面板样式
5. 回归验证（构建 + 核心交互）

## 8. Acceptance Criteria

- 打开系统默认进入 Dashboard
- 登录后进入 Dashboard
- Chat 左侧显示模块列表，不再显示会话列表
- Chat 右侧可完整管理会话（搜索/新建/改名/删除）
- 移动端可分别打开模块抽屉与会话抽屉
- 现有对话功能与流式能力不回退
