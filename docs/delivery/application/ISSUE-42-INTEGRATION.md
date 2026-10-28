# Issue #42 公共集成交接（2026-10-28）

## 当前核对

GitHub #42 正文及补充验收已通过公开 REST API 实时只读读取；comments 分页首批为空。当前 `/platform/settings` 已绑定 `PlatformSettingsPage`，但 `web/layout/CompatWorkspace.vue` 仍挂载平台 `CoefficientChanges`，造成重复实例和 GET。`PlatformProcurement` 的重复计价由 #41 协作处理，本会话不编辑该文件。

## 必须执行的公共集成

- `application/web/layout/CompatWorkspace.vue`：移除平台专用 `CoefficientChanges` 挂载及 import；保留跨角色 `CoefficientNotice`，它服务原有通知可见性。核对 #41 移除采购内计价，避免设置页与旧采购同时保存同一配置。
- `application/web/App.vue`：在现有有范围 KeepAlive 的 include 中加入 `PlatformSettingsPage`，沿用会话代次 key 在退出、改密、401、换账号时销毁。页面组件将声明该 name。只缓存设置页；返回不得重新 GET 或 POST，不使用 fullPath 全局 key。
- `application/web/router/**`：保持 `/platform/settings` 真实页面和平台权限，清除仅为旧系数组件服务的兼容 target（当前未发现独立 target）。本票组件接入现有 `useFormLeave`，不需要新增公共 API。
- `server/app.ts`、`vite.config.ts`：核对 `/platform/settings` 的生产及开发 GET/HEAD 深链承载；保留未知 API/静态资源拒绝。

## 生命周期契约

计价、通知发布、指定 change.id 生效分别登记 dirty/submitting/unknown。提交中阻止离开；未提交取消保留输入，确认放弃才清空；未知结果锁定原输入及请求标识，确认后可离开并由限定缓存保留，返回不重发，用户可明确重试同一幂等请求核实。刷新仅 GET，不自动保存/发布/生效。完整刷新无持久草稿恢复承诺。参数更新经过同一公共保护。

保持 `minimumMarkup` 非空条件；`interfacePath` 非空才提交原表单中的单价、最大量和 evidenceType；evidence 原值；通知 requestId、coefficient、ISO effectiveAt、notice 不变；activate.id 严格来自 changes[].id。

## 集成验证待办

完成后运行本票真实后端浏览器场景，确认单实例 GET、菜单/账号设置往返、取消/放弃、History、未知结果保留、提交中阻止、四角色拒绝、退出缓存清理。集成未完成前不能将本票宣布完成。

## 当前集成验证结果

公共会话已移除 CoefficientChanges/PlatformProcurement 旧兼容挂载并加入限定缓存；本票未编辑共享文件。生产构建和本票 Vite 入口的真实浏览器测试均通过，核对 settings 单份系数表单、返回无重复系数 GET/POST、dirty/submitting/unknown 与账号设置/History/会话清理。当前不存在本票必需且未实施的公共集成项；无业务参数 query 变化仍未专项执行，详见 COMPLETION。保留跨角色 CoefficientNotice 与其他未迁移模块，未宣称全局兼容容器退出。

## 公共会话最终复核

2026-10-28：上述共享路由、限定缓存、兼容挂载移除和History要求已实际集成。公共浏览器13项、补充离开机制2项、真实身份/重置12项及策略3项通过；各票真实业务验收仍以本票证据和边界为准。完整共享文件、参数来源、实际命令与未验证范围见 [并行集成汇总](PARALLEL-PLATFORM-INTEGRATION-2026-10-28.md)。保留分销/终端兼容模块，不宣称全局退出。#40库存待补分支仍是整票业务缺口。
