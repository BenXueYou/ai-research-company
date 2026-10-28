# #36 可接入

组件：`application/web/help/RoleHelpPage.vue`；`role: string` 接收认证会话原始角色值 `platform` / `distributor` / `admin` / `sales`；触发 `navigate(path: string)` 交由现有导航处理。请在 `/help` 单独挂载，隐藏兼容容器，按角色保留平台菜单或其他角色侧栏底部帮助入口；完成后写 `coordination-36-integrated.md`。

补充：当前 App 中四角色均使用 `sidebar-help`，请将平台帮助入口置于平台主菜单（分销/终端保留侧栏底部），并更新接入标记。专项浏览器测试通过入口与切换，仍需核对位置。
