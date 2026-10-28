# #45 页面接入就绪

`application/web/upstream/UpstreamMonitorPage.vue` 已可导入，接收 `request: (path: string, body?: Record<string, unknown>) => Promise<unknown>`，复用既有监控组件和请求契约。请在平台合法路径 `/platform/reconciliation/upstream` 单独挂载，并处理 History 承载及菜单高亮；接入后按约定写 `coordination-45-integrated.md`。领域页面已就绪，浏览器验收尚未执行。
