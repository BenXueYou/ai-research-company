# #41 公共集成交接

2026-10-28：已实时只读核对 GitHub #41 正文及补充验收；comments API 返回空列表。公共集成完成前，本票不视为整票完成。

- `web/router/index.ts`：新增真实页面 `/platform/ledger/procurement` → `pages/commerce/PlatformProcurement.vue`，role 仅 `platform`，business=true，导航组“点数与账务”、菜单“采购与费用”，面包屑同名；加入 `isBusinessPath`。
- `web/App.vue`：限定 KeepAlive include 加入 `PlatformProcurement`，使用现有会话代次边界销毁缓存；request 属性保持既有会话 request，无新增业务参数。
- `web/layout/CompatWorkspace.vue`：移除 `PlatformProcurement` 导入和 `<PlatformProcurement id="compat-settings" ...>`；核对 `compat-settings` 与相关定位无调用方后删除。本组件原条件仅 `session.role === 'platform'`，无事件联动。其他角色兼容模块继续保留。
- `vite.config.ts`、`server/app.ts`：合法前端 GET/HEAD History 路径加入 `/platform/ledger/procurement`；未知 API/静态文件不回退 HTML。
- 计价完整表单已有 `PlatformSettingsPage` 中 `PricingSettings` 承载（#42 负责），采购页将删除旧重复计价表单；采购页仍显示服务端系数、库存成本和最低售价供核对。

生命周期：页面接入 `useFormLeave`。dirty 可继续编辑/确认放弃；submitting 阻止离开；unknown 保留每笔原始请求字段和 requestId，允许确认离开，返回不读取、不写入、不自动重试。页面内只由明确的刷新/原请求核对按钮发请求。未知结果须保留页面实例，故缓存与移除兼容挂载必须原子集成。刷新不承诺跨刷新恢复。无 route query 业务取值，同组件参数变化走公共离开保护，不改变载荷来源。

测试资源：计划独立 `.scratch/issue41-*` 产物、Playwright 输出，端口 3441，运行时随机创建 `issue41_*_test` 数据库；不写共享 dist/test-results，不修改公共集成文件。


## 已集成验收（2026-10-28）

公共收尾会话已将以上入口、缓存、兼容挂载移除、生产/开发 History 接入工作区；本会话未编辑其文件。最终专项配置已去掉全部内存源码变换与测试后端 History 补丁，直接构建当前真实源码并运行通过：`1 passed (12.2s)`。两类未知结果的原请求核对、切页返回零额外读写、同浏览器退出换账号缓存清空、生产深链刷新、开发 HEAD 和缺失路径 404 均通过。证据及命令见 [完成记录](ISSUE-41-COMPLETION.md)。本票公共集成无剩余待办；其他角色兼容模块继续保留。

## 公共会话最终复核

2026-10-28：上述共享路由、限定缓存、兼容挂载移除和History要求已实际集成。公共浏览器13项、补充离开机制2项、真实身份/重置12项及策略3项通过；各票真实业务验收仍以本票证据和边界为准。完整共享文件、参数来源、实际命令与未验证范围见 [并行集成汇总](PARALLEL-PLATFORM-INTEGRATION-2026-10-28.md)。保留分销/终端兼容模块，不宣称全局退出。#40库存待补分支仍是整票业务缺口。
