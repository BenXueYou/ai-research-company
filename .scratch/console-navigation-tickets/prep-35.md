# #35 实施准备（只读基线，2026-10-28）

这是准备报告，不是工单完成记录。`status-snapshot.json` 中 #35 和阻塞项 #34 均为 open；该快照不是实时状态。#34 尚在实施，开始 #35 前须确认其实际交付和依赖状态，并重新读取当前代码及未提交改动。本次没有执行应用、数据库或浏览器测试。

## 契约和当前入口

- 权威范围：`需求设计/10-控制台角色导航与页面迁移Spec.md` 的「路由与公共交互」「Testing Decisions」及 `docs/decisions/001-t01-identity.md`；完整 #35 验收及原生依赖见 `.scratch/console-navigation-tickets/status-snapshot.json`，编号映射见 `published.json`。`docs/engineering-scaffold.md` 要求迁移前后逐字段对照与业务验证。
- 当前 `application/web/App.vue`：`Session`、`request`、`loadSession`、`run`、`login/logout/changePassword/openSettings/closeSettings`。正常账号通过 `settings` 布尔值进入同一改密表单；返回只是清空密码并切回工作台，当前没有记录来源页面。强制改密与主动改密共用表单，强制态不提供返回。`run` 在 busy 时拒绝重复调用，表单输入和提交按钮禁用；打开/关闭清空密码及错误。请求为同源 cookie，POST 附 CSRF；401 清空本地 session 与密码。成功后清空会话和密码、显示重登提示。
- `/api/auth/session` 返回账号 `id`、`email`、`loginName`、`role`、`organizationId`、`mustChange`；`POST /api/auth/password` 的实际请求体是 `currentPassword`、`newPassword`、`confirmPassword`，目标账号来自会话 token，成功返回 `{ok:true}` 并清两个 cookie。`application/server/identity/controller.ts`、`guard.ts`、`identity.ts`、`policy.ts` 是具体依据。
- 客户端校验新密码为 12–128 位 ASCII `0x21–0x7e`、两次一致；服务端另验证当前密码及新旧不同。错误密码、相同密码、格式/确认不符均拒绝；不可通过传入 accountId 选取他人。密码只存加盐摘要；不要把测试密码或 token 写入交付证据。
- 服务端守卫对变更要求正确 Origin、JSON 与 CSRF；未认证 401，临时凭据仅可 session、password、logout，其余业务 403。认证检查账号和组织启用、会话绝对 8 小时、空闲 30 分钟、临时凭据 72 小时；主动或强制改密事务内删除账号全部设备会话。平台 `super_admin` 是唯一非邮箱例外，初始凭据只用于初始化及首次强改；普通邮箱仅域名小写，保留本地部分大小写、加号和点。管理重置逻辑在 `server/identity/password-resets.ts`，重置后旧会话撤销并进入强改。

## 待实施验收与证据

1. 用四角色各自认证会话访问设置，右上角进入时记录此前合法业务 URL；取消/返回回该 URL，来源缺失、非法、无权或非业务页面回该角色默认页。测试直达、刷新、前进/后退、角色切换，以及未登录、无权和强改态直达；不能使用过期的上一账号来源或读取无权数据。成功改密是登出重登，不返回业务页继续旧会话。
2. 对真实账号表单分别测试菜单、返回、浏览器后退：输入后选择继续编辑保留三个字段且无 POST；选择放弃才离开；未修改时不提示；返回重新进入没有跨页面持久化草稿。覆盖错误当前密码、新密码边界/空格/非 ASCII、两次不一致、新旧相同，验证拒绝无密码变更；成功后本设备和另一设备旧 cookie 均 401，新密码可登录、旧密码不可登录。强改、管理重置后强改、退出、临时/绝对/空闲到期及直接 API 守卫均回归。
3. 提交中的请求与未提交输入是不同状态。路由离开、卸载不能自动调用取消、退款、释放预留、重发或视为成功；结果未确认时应按该业务原有机制核对。对真实受影响表单模拟服务端已提交但响应丢失、切页再返回，断言请求次数、持久结果和余额/流水；不要把离开提示当作幂等保障。先核实组件卸载对现有请求标识的影响，后续票接入时逐业务验证，不能声称所有表单已保护。
4. 身份夹具令组织 ID、本人账号 ID、其他账号 ID 不同，登录邮箱与回复邮箱也不同；采集账号表单的实际三个字段和来源、会话 token 对应本人及落库目标，附带伪造 `accountId` 的拒绝覆盖证据（当前服务忽略该额外字段并仍修改本人，见 `identity.test.ts`，不要误写成 HTTP 必须拒绝）。对实际选择链路，例如组织 `child.id` 与 `child.accountId`、订单 buyerId 与 orderId、U-Mail organizationId 与 resourceId、费用各损耗 ID，设置不同值并记录选择、请求、服务端结果；只对本票实际接入链路实施，不添加兜底。

## 表单状态和防重复基线

这些能力主要是后续表单的接入依据，当前不代表已解决跨卸载保存：

| 位置 | 当前状态及关键参数 |
| --- | --- |
| `web/organizations/OrganizationOpening.vue` | name、kind=`terminal`、countryCode=`+86`、phone、email、requestId；busy 或尚有一次性 credentials 阻止开户。成功后凭据展示直到关闭，关闭才清输入并生成新 requestId；失败保留标识。管理员重置取所选 `child.accountId`，组织状态取 `child.id`；重置每次新 UUID，失败提示先核实。 |
| `web/organizations/MemberManagement.vue` | name、email、role=`sales`、requestId；busy/凭据门禁及关闭后换标识；重置和停用取所选 accountId。服务端从会话取组织。 |
| `web/commerce/PointOrders.vue` | buyerId 来自 children 的 id；建单 quantity/unitPrice，其他操作 orderId 来自 selected/order.id；收款凭据及退款依据各自保留。busy 禁用按钮；`pending` 按 path 和 JSON body 保存 requestId，成功请求后删除，失败保留；Map 在组件内。 |
| `web/commerce/PlatformProcurement.vue` | purchase 默认 purpose=`sale`，expense=`failure`，pricing evidenceType=`supplier_verified`；按操作和序列化值保留 requestId，相同值重试保留、编辑后换新，Map 在组件内；busy 防重复。采购仅非 sale 且选择时传 expenseId；损耗引用各有独立字段。 |
| `web/commerce/CoefficientChanges.vue` | coefficient、effectiveAt、notice 和 requestId；成功换 UUID，busy 守卫；生效操作取 change.id。 |
| `web/email/TeamSmtpSettings.vue` / `TeamUMailSettings.vue` | SMTP 默认 port 465/security tls；各自的输入、默认渠道及 requestId，busy 守卫，成功换 UUID；SMTP 成功清 credential。区分 username、登录邮箱、replyTo；U-Mail 区分 domain、senderAddress、replyAddress。 |
| `web/email/UMailResourceSettings.vue` / `PlatformEmailQuota.vue` | 资源配置传选择的 organizationId、resourceId、requestId，成功换 UUID；额度默认 2000，选中项的 organizationId 与整数 dailyLimit 发送，当前没有 requestId，按钮禁用 busy，`save` 没有显式 busy 早退。不要一概宣称所有表单具有相同幂等机制。 |

订单、采购服务端分别有请求记录及重放处理；组织开户、SMTP、U-Mail 也有各自请求记录/处理，具体同键冲突和一次性凭据语义须逐服务核对。前端 requestId、pending Map 是组件内存，组件重建会丢失；服务端已有记录并不能证明新 UUID 的重试安全。账号改密不含 requestId，响应丢失时可能已经撤销会话，不能自动重发或显示确定成功。

## 可复用测试与运行入口

在 `application/` 下，先核对 #34 后的 `package.json`、实际测试文件和专用环境；以下是本次读取时入口，不是执行结果：

- `npm test` 仅运行 `tests/policy.test.ts`；覆盖邮箱规范、密码边界、临时密码和摘要。
- `npm run test:integration` 编译至 `dist`，串行运行包括 `dist/tests/identity.test.js` 的六个文件；身份测试覆盖强改权限、CSRF/Origin、到期、全设备撤销、并发主动改密、四角色本人目标和平台初始化。专项运行可先 `npx tsc -p tsconfig.server.json`，再 `node --env-file-if-exists=.env.test --test --test-concurrency=1 dist/tests/identity.test.js dist/tests/password-resets.test.js`；后者不在基础集成脚本中。
- `npm run test:e2e -- identity.spec` 会先 build，再由默认 Playwright 配置运行 `dist/tests/browser/identity.spec.js`；该测试使用真实 Nest、PostgreSQL 和两个浏览器上下文。`npm run test:e2e -- password-resets.spec` 覆盖选中账号 ID 与组织 ID 不同、一次性凭据和重置强改；`npm run test:e2e -- organization-state.spec` 可参考真实用户操作、授权及组织状态。实现后需更新这些旧工作台定位并增加上述路由和丢响应场景；现有测试不能自动证明 #35。
- 这些命令会写 `dist`、前端构建输出和测试结果，并清空测试库。实施时只用显式指定、独立可丢弃且库名以 `_test` 结尾的 `TEST_DATABASE_URL`，不并行共享数据库；检查 3091/3092 端口与依赖，使用受控适配器，不依赖真实供应商。当前准备阶段未运行上述命令。

## #34 落地后重新核对

重新确认实际的路由配置、角色默认页、合法来源判断、账号入口、强制改密/未登录守卫、组件生命周期与前进后退行为；检查 #34 的兼容业务容器是否卸载及是否重复加载，确认会话更新、401 和角色切换如何清理状态。根据真实接口选择离开提示接入点，避免假设路由库、组件名称或 API 已存在。先建立改动前的参数及真实流程基线，再实施；记录执行场景、未验证流程和未覆盖的后续业务表单。
