# #57 团队发信设置页面进度

工作区公共路由、App 和兼容容器已有其他任务的未提交修改。本次新增 email 页面，直接组合原 SMTP 和 U-Mail 组件；公共文件和服务端未修改。当前路由仍指向兼容工作区，#57 尚未完成集成。

## 契约对照

页面按会话角色传入 `canMaintain`：管理员为 true，业务员为 false。原组件和服务端均未变，迁移前后字段来源一致：

| 请求 | 字段及来源 |
| --- | --- |
| SMTP GET | 无请求体。 |
| SMTP POST | 表单 `host`、字符串 `port`、`security`、`username`、`credential`、`replyTo`、`defaultChannel`；组件生成 `requestId`。成功后清空凭据。 |
| U-Mail GET | 无请求体。 |
| U-Mail POST | 表单 `domain`、`senderAddress`、`replyAddress`、`defaultChannel`；组件生成 `requestId`。 |

两类请求均不传组织或资源标识；服务端从会话确定企业，从该企业资源记录取得 U-Mail 外部资源标识。受控适配器及凭据存储代码未改变。隔离浏览器夹具使用不同的 SMTP 发信账号、SMTP 回复邮箱、U-Mail 发信邮箱和 U-Mail 回复邮箱，检查请求字段和值；模拟响应不证明服务端租户隔离或适配器行为。

## 验证及待办

- `npm run typecheck`：通过。
- `node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue57.config.ts`：通过，覆盖管理员两类表单提交、字段及回复地址、SMTP 凭据清空，业务员只读且只发 GET。
- 未运行会清空测试库的真实 HTTP/数据库及浏览器专项，避免与并行任务共用测试库；真实供应商联调未执行。
- 集成方需将 `/terminal/sending-settings` 接到新页面，移除兼容定位目标，从 App 的兼容路径判断及兼容容器移除该模块，避免重复挂载；保留角色门禁，传递现有 role 和 request。
- 集成前需实现并验证配置表单的离开确认、后退、刷新/关闭，以及提交中和结果未确认时的请求标识与状态生命周期。当前尚无页面级导航保护。
- 在专用隔离测试库执行现有 SMTP/U-Mail 服务端专项，验证允许与拒绝、租户隔离、凭据和受控适配器；再验证真实路由直达、刷新、切换、退出和跨账号会话。正式连接、DNS、实际投递另行联调。
