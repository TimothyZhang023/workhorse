# workhorse 桌面化升级结果

> 最后更新：2026-03-14  
> 状态：已落地

## 1. 本轮升级目标

把原来的 Web 项目重构为桌面优先的 standalone agent 工作台，核心要求：

- 移除对 Umi Max 的依赖
- 切换到 `Vite + React Router`
- 引入 `Tauri 2` 桌面壳
- 保留 `Node.js` 后端作为 sidecar
- 默认本地免登录运行
- 支持 OpenAI 兼容接口作为 AI 网关

## 2. 实际落地结果

### 前端层

- 入口从 `src/app.tsx` 切到 `src/main.tsx`
- 路由由 React Router 承担
- 根路由 `/` 默认跳到 `/chat`
- 组件库从 Umi 插件切换到 Ant Design Pro Components
- Dashboard、Chat、MCP、Skills、Agent Tasks、Cron Jobs、Endpoints、System Settings 作为独立模块页面

### 后端层

- `server/app.js` 不再承担旧的 Web 静态托管和 Umi 开发代理职责
- `/api/*` 默认统一注入本地用户上下文
- 登录、账户、后台管理相关旧路由已经移除
- 新增系统概览和历史清理等 standalone 场景接口
- OpenAI 兼容代理接口已移除，以确保单机模式下的极致隐私与安全
- MCP 代码生成、技能生成、任务生成等 AI 辅助功能

### 桌面层

- `src-tauri/` 新增 Tauri 配置
- 桌面壳启动时拉起 Node sidecar
- 前端请求层在桌面环境下默认指向 `http://127.0.0.1:8080`

### 数据层

- 数据库使用 `better-sqlite3` 同步操作
- API Key 使用 `crypto` 模块加密存储
- 模型配置支持文件存储 (`~/.workhorse/models/`)
- 支持运行时数据库迁移

## 3. 当前关键约束

- 当前主路径是桌面单机模式，不再默认支持旧登录流
- 直接使用相对 `/api` 路径在桌面生产环境会断，所以请求层必须统一处理基址
- Node sidecar 和打包平台需要匹配，否则桌面产物无法正常运行
- Tauri 2 需要 Rust 工具链支持

## 4. 本轮补齐的配套

- README 已更新为当前桌面优先说明
- `docs/project.md` 已更新为当前架构说明
- Tauri 元数据与版本号需要跟随主版本维护
- 新增请求层回归测试，覆盖桌面环境下的 API 基址解析
- 测试用例覆盖核心业务逻辑

## 5. 验收标准

- `npx tsc --noEmit` 通过
- `npm test` 通过
- `npm run build:frontend` 通过
- `npm run build:tauri` 能产出桌面包
- 打开的桌面版能够正常访问本地后端

## 6. 技术债务与后续优化

- [ ] 旧数据库迁移脚本需要完善
- [ ] 多用户体系虽然在但默认不启用
- [ ] 部分旧 API 路由仍有残留代码可清理
