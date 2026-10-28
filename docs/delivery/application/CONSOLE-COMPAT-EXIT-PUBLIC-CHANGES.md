# 控制台公共兼容退出：稳定公共变更清单

2026-10-28。供同批会话只读核对；最终结果见 CONSOLE-COMPAT-EXIT-COMPLETION.md。

- App 保留根组件、身份/改密、请求绑定、公共离开 provider 和原有限 KeepAlive 名单。删除 CompatWorkspace 导入/挂载、workspaceVisited、isCompatPath 及其专用 menu/currentTitle/watch。
- router 保留四角色门禁、业务 URL/query/hash、未知地址回默认、历史位置滚动恢复；删除已无引用的 meta.target 和锚点滚动。业务菜单改显式真实组件映射，缺少映射直接报开发错误；EmptyRoute 仅保留未知路由，SettingsRoute 保留账号设置占位职责。
- layout/ConsoleNotices.vue 在正常认证会话下、RouterView 外按 generation 存活，展示所有四角色原系数通知；跨业务页、帮助、账号设置只读一次，刷新重新读取。临时凭据不挂载；退出/401/换账号销毁。
- components/CoefficientNotice.vue 为从原组件原样迁出的跨业务通知实现：GET coefficient/notices，无参数/写入/已读确认/轮询/重试，失败沿用空列表。layout/coefficientNotice.ts 是布局唯一通知所有权的注入 key。
- pages/commerce/components/CoefficientNotice.vue 仅为现存分销订单调用方保留薄适配：公共布局拥有通知时不再挂载第二实例；脱离公共布局时仍用全局通知组件呈现。未修改 DistributionPointOrdersPage 或分销/终端业务组件、服务、API 参数。
- formLeave、Nest/Vite History 入口没有产品代码变更；独立测试核验现有入口和保护。
- 删除 CompatWorkspace 前已确认 #57 completed 并读取 ISSUE-57-COMPLETION.md。不修改其他票交付或全局 Spec。

共享工作区其他未提交 App/router 变更（分销真实页面及 #57 缓存名单）为进入本票时已有成果，不计入本次公共实现。基线快照保存在忽略目录 application/.scratch/compat-exit/*before*。
