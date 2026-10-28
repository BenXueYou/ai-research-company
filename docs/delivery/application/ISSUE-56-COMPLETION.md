# Issue #56 邮件发送记录与批次结果核对

日期：2026-10-28（Asia/Shanghai）。本地实现和隔离环境验收完成；未部署、重启现有服务、提交、推送或关闭工单。

## 基线、目录与并行集成

- 基准提交 `eee101bb054c79f3e524241c03d11279587bb10a`。开始时已有 #52/#58/#59 未提交成果；期间 #53/#54 在共享目录接入找企业页面。本票保留这些成果，不以整个工作区 diff 作为本票改动。
- 已读取实时 GitHub #56（open，updated_at `2026-10-28T09:56:00Z`）、工程脚手架、应用 README、控制台迁移 Spec v1.2、既有邮件发送服务与 T22～T25 记录，并按实际代码核对状态及权限。远端 open 状态不作为实现缺失的依据。
- `web/pages/email/EmailRecordsPage.vue` 承载 `/terminal/emails`，`?batchId=<批次UUID>` 定位详情；`web/api/emailRecords.ts` 保留原请求适配。旧 `EmailSendRecords.vue` 已删除，旧 `CompatWorkspace` 挂载、导入和 `compat-emails` target 移除；没有全局组件或新的服务端 API/数据库变更。
- 公共文件仅增量接入：router 导入/页面映射/移除本票 target；App 缓存名单加 `EmailRecordsPage`、兼容路径排除 `/terminal/emails`；CompatWorkspace 仅移除本票旧组件。并行 #53 的缓存与路径排除、#52/#58/#59 页面继续保留。
- Nest 与 Vite 已有 `/terminal/emails` History 白名单，本票无需修改装配或 Vite 配置。兼容容器仍有分销开户/订单/报表、团队发信设置等调用方；本票不表示兼容容器全局退出。未改 #57 设置、#53/#54 搜索业务代码。

## 迁移前后契约

旧组件通过 `props.request` 调用以下接口；新页面经 `emailRecordsApi(props.request)` 调用同一接口，字段及来源不变。真实随机测试值、浏览器载荷与落库见 [ISSUE-56-EVIDENCE.json](ISSUE-56-EVIDENCE.json)。组织、账号、批次、档案、联系人、逐收件人 UUID 均不同，原来源 `list-111`、详情 `detail-222`、源 `source-id-N`、`file-id-N` 和 `mailsou-N` 也不混用。

| 链路 | 迁移前来源与参数 | 迁移后来源与参数、服务端结果 |
| --- | --- | --- |
| 列表 | GET `email-batches`，不提交组织 | 同一 GET；服务端 `identity.organization_id` 限定本企业共享批次，原渠道、计数、状态、回复地址和额度日期保持 |
| 批次详情 | 点击列表项 `batch.id` → POST `email-batches/detail` `{batchId}` | 列表项 `batch.id` 写入 URL `batchId`，详情仍只传 `{batchId}`；服务端批次 + 会话组织共同定位，跨租户 404，无回退标识 |
| 档案入口 | 既有批次 `profileId` 来自 `email_batches.profile_id` | 详情响应 `batch.profileId` → `/terminal/profiles?id=<profileId>`，不使用批次/组织/收件人 ID 代替档案 ID |
| 核对 | 所选行 `recipient.id` → `{recipientId}` | POST `email-recipients/reconcile` 同值；仍仅原 queued/paused 之外的既有状态可由服务端核对，页面保留 submitting/uncertain/accepted 的入口；可靠证据才能显示送达 |
| 手动重发 | uncertain 且 checkedAt；风险确认后 `{recipientId,confirmPossibleDuplicate:true}` | 同状态、同原行 ID、同确认字段；服务端仍只允许原发送人，复制原邮箱/联系人/档案/mailsouId/内容/渠道，唯一子尝试防重复；明确失败不新增重发入口 |
| 跨日重确认 | paused 行先 GET `email-quota`，显式确认退订和今日额度，再 `{recipientId,confirmUnsubscribeNotice:true,confirmQuota:true}` | 相同原行 ID 和两个布尔值；预览快照、退订、渠道、附件、原发送人及新日额度仍由既有服务校验；确认仅排队，不发送 |
| 重确认后执行 | queued 且 reconfirmedUsageDay，`{recipientId}` | POST `email-recipients/execute` 同一原收件人 ID；不传 batchId/profileId/organizationId，服务端定位所属原批次并检查原发送人，重复执行不增加调用 |

未根据字段名称推断 ID，未增加 `fileId || id` 等回退；没有修改枚举、默认额度 2000、权限、原发送人限制、校验、幂等或生命周期业务规则。保留既有读取/额度入口调用 `pauseExpired` 的行为：旧日 queued 暂停并释放旧日预占，submitting/uncertain 保留原日预占；读取不是纯数据库零写入，但不会自动调用发送供应商。

## 页面生命周期

- 限定缓存本页，按 App 会话 generation 销毁。普通离开/返回、账号设置返回与同组件 query 切换只读取列表/详情，均不核对、重发、重确认或执行邮件。
- 操作及确认弹窗期间公共 `useFormLeave` 阻止离开；请求失败且结果可能未知时保留原 action、完整 body、batchId 与提示。离开可取消或确认，返回仍保留上下文；所有操作按钮暂时禁用，用户主动“查看原批次核实结果”只读原批次，之后再自主决定后续操作，不重放原写请求。
- 每次读取清除旧详情；失败不显示旧收件人。序列号防止同页旧读取覆盖新 query；组件销毁后的响应不更新状态。会话切换销毁缓存及打开的本页确认框，request 层继续执行会话代次检查。
- 内存上下文不提供跨刷新草稿恢复。刷新通过原批次深链读取真实状态；服务端幂等仍为最终防重复边界。

## 实际命令与环境

在 `application` 目录执行：

```powershell
npm run typecheck
node node_modules/typescript/bin/tsc -p config/tsconfig.issue56.json
node node_modules/vite/bin/vite.js build --outDir .scratch/issue56/web
node scripts/verify-issue56.mjs
```

类型检查、独立服务端编译、独立前端构建和最终专项均通过。Vite 有既有 bundle >500 kB 的非阻断提示。专项 `1 passed`，真实 Chromium + Nest HTTP + PostgreSQL 17.6；受控边界仅 SMTP 发送和渠道证据。`verify-issue56.mjs` 创建随机容器、随机密码和映射端口，专项再创建随机名 `_test` 数据库；HTTP/Vite/代理后端端口由系统分配。编译、网页和 Playwright 输出只写 `.scratch/issue56`，trace/截图关闭，不使用共享 dist 或 test-results。finally 只删除本套件创建的随机数据库、容器及卷；未连接共享或开发数据库。

开发过程中修正了并行公共接入覆盖本票缓存名单、测试随机发送顺序假设、Element Plus 弹窗退场等待与丢响应后的异步等待；最终场景重新执行通过。补验阶段曾出现一次 Playwright worker 启动即异常退出（0ms，3221226505），同一代码重试通过，不将异常退出计为通过。

## 实际业务结果

- 初始受控服务生成三封，分别 accepted/not_submitted/uncertain，适配器调用 3 次。列表/详情直达、刷新、返回、前进后退及开发 History 验证没有自动发送。
- 核对渠道失败 503 保留未知上下文；取消离开保留页面，确认离开再返回不自动核对。主动查看原批次只读，随后显式核对 unknown 才开放风险重发；取消重发没有调用。
- 真实后端完成一次 retry 后仅丢响应：新子记录保留原 organization/profile/contact/mailsou/email，调用增至 4；页面保留原目标，通过只读核实看到新尝试。相同父收件人重复 retry 返回原子尝试，无第 5 次调用；失败项 retry 409、缺风险确认 400。accepted 经可信 delivered 证据展示送达，重复同证据只有一条证据记录。
- 旧日 queued 被既有扫描改为 paused，旧日 reserved=0；重新确认后仍为 queued，供应商调用仍为 4，重复重确认 409。刷新不自动执行；点击执行后调用增至 5，重复 execute 不增加调用。
- 最终本企业当日 `reserved=1,used=3,remaining=1996,dailyLimit=2000`；原不明尝试继续预占。五类点数账户/库存/查询流水表与操作前完全一致，两企业余额夹具 100/200 不变。
- 管理员、业务员共享读取本企业详情；业务员核对已有证据允许，非原发送人 retry/reconfirm 403、指定执行 404。另一企业列表不含原批次，猜测详情与四类收件人操作全部 404。平台/分销直达被角色守卫送回各自首页，列表 API 403；未登录 401；强制改密不挂业务页、API 403。
- 真实数据库读取失败时清除旧详情；截留真实详情响应，在业务员退出并登录另一企业后释放，旧批次和邮箱不残留。生产构建承载与 Vite 代理均验证详情直达刷新；未知 API 不返回 HTML、缺失 JS 404。

## 未验证边界

- 未连接正式 SMTP/U-Mail、真实投递/回执/退信、附件供应商兼容或真实北京时间零点定时器；使用旧日夹具触发既有扫描。正式联调仍归 T31/T32。
- 本票浏览器专项使用 SMTP；未重跑 U-Mail 全流程、发送预览/模板/附件/联系人选择到初次发送的完整既有专项，未做高并发压力、停用组织全链或全部跨日多次及乱序回执组合。原邮件服务与规则未修改，T22～T25 历史证据不能冒充本票重新执行。
- #52 档案链接已逐值核对；档案维护、#53/#54 搜索与 #57 设置的完整联合回归不在本票结论中。仍有兼容模块，不宣称全局退出或生产可投递。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动，同时应用 Vue 技能。
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021～027、030；GUIDANCE FCS-014、032；不变更依赖与工具配置。
- 校验结果：`npm run typecheck`、隔离 tsc、隔离 Vite build、Issue56 浏览器专项均通过；`git diff --check` 按本票文件范围执行。lint/format 未执行，项目无对应脚本或配置；`npm test`、常规集成、其他专项未执行，与本票验证范围无关且部分默认脚本写共享产物。
- 冲突：无。存量规范债务：本票未扩展清理既有公共文件格式或 bundle 大小。
- PENDING：FCS-001～006、008～010、012、015～018、020、031、033～035 不提升为硬性约束，未依赖其未决解释。
