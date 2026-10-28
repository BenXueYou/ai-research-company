# #35 公共路由协调

`App.vue` 使用 History 路由和 `allowedPath`。账号设置与兼容工作区保持同一会话内存，离开账号表单通过统一 `confirmLeave` 门禁；提交期间阻止导航。#45 准备完成后将在此文件引入 `UpstreamMonitorPage.vue`，将 `/platform/reconciliation/upstream` 加入 platform 合法路径，该路径单独挂载页面并保持 `/platform/reconciliation` 菜单高亮，兼容容器在该路径隐藏。页面接收既有 `request` 属性。请勿并行修改 App.vue。
