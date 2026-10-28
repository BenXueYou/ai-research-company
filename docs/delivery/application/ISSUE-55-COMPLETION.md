# Issue #55 档案联系人查询与单轮邮件发送

日期：2026-10-28。本地实现及受控边界验收完成，GitHub 工单保持 Open；未部署、重启用户服务、提交、推送、关闭工单或进行正式查询扣费/发送。

## 基线和范围

通过 GitHub REST 实时读取 `BenXueYou/ai-research-company/issues/55` 正文及补充验收，comments 无业务补充。读取 AGENTS、工程脚手架、应用 README、控制台迁移 Spec v1.2、第一阶段 Spec 的查询/联系人/邮件/额度规则、T14/T15/T21–T25 交付及现有服务端实现、#52 生命周期与 #56 邮件记录实现。核对时 HEAD 为 `2bf193c`；共享工作区已有其他任务的未提交代码和样式，未 reset/stash，也未覆盖其他任务成果。

`/terminal/profiles?id=<内部档案ID>` 已由 #52 的 CompanyProfilesPage 承载，CompanyProfileDetail → CompanyContacts → EmailComposer 均在 `pages/companies/components` 内，按实际单模块调用关系保持原位。列表请求适配继续使用 `web/api/companyProfiles.ts` 和会话 request；报价、草稿、预览、发送的请求契约及服务端不变。没有另建重复路由页或联系人实例，也没有引入模板管理。

本票实际业务改动只有：

- CompanyProfileDetail 的原请求跟踪增加识别逐收件人 `uncertain/submitting`，保留原 path/body（含 batchId），纳入已有未确认结果离开保护；原 `state=pending` 查询和网络/5xx 未知规则继续保留。
- EmailComposer 按执行结果显示待确认收件人数及“预占保留、到发送记录核实”的提示；保持原单轮按钮和 batchId 防重，不自动核对、重试、退款或释放额度。
- 新增本票浏览器专项、独立执行器、配置和脱敏证据；`.gitignore` 只追加本票产物忽略及所用测试源白名单。原来被忽略的 company-contacts/email-preview 测试内容未修改，补入白名单使运行器依赖可交付。

CompanyContacts、EmailComposer、CompanyProfileDetail 上其他会话已有的样式/获取时间格式化完整保留，不计入本票实现。未修改 #57 渠道表单、#56 发送记录、#52 档案编辑/附件/时间线，以及 App/router/History 公共接线。

## 路由及生命周期

核对 router 真实绑定、App 限定 CompanyProfilesPage KeepAlive、会话 generation 销毁和 CompatWorkspace 引用。联系人和邮件已没有独立兼容挂载、target 或滚动定位，本票不再删除其他公共逻辑。并行 #57 将渠道页移出后，复核时兼容容器仍有 CoefficientNotice；其他任务尚未结束且没有全角色退出联合证据，故保留容器，不声称全局退出完成。

档案 query.id 变化使用按内部 ID 区分的详情实例；切换已访问档案保留对应草稿、快照、原 queryId/batchId。菜单、前进后退取消离开保持 URL 和上下文；确认离开未知请求后返回不重发。提交中沿用原离开阻止。退出成功按 generation 销毁页面局部上下文，新账号不继承旧预览。浏览器刷新只读取档案与本地联系人，不重放 execute，不新增跨刷新未知上下文恢复能力；持久化批次和额度保留在服务器，继续从既有记录核实。

## 修改前后契约对照

| 动作 | 修改前来源与最终请求；修改后保持 | 服务端及验证 |
| --- | --- | --- |
| 打开档案/联系人 | URL id=company_profiles.id；本地读取 `{profileId:profile.id}` | 本企业已确认档案，进入/刷新无供应商调用 |
| 每页报价/更新 | `{profileId:profile.id,positionTags:[...输入],pageNo:所选页,pageSize:20}`；主动更新仍第1页，TECHNOLGY 原拼写保持 | 价格/系数与最高计费量不变；取消只清本地报价，不调用 execute、不扣点 |
| 执行收费查询 | `{queryId:报价响应.queryId}` | 联系人上游仅 `{companyName:已确认档案名称,positionTags,pageNo,pageSize}`，不传列表/详情/内部主键；重复同 queryId 不二次调用 |
| 归属确认/退订 | `{contactId:联系人内部id,reason:逐条说明}`；退订 `{contactId,unsubscribed:原状态取反}` | 保留源 returnedCompanyName、待核实默认不选；单条退订不传播同邮箱联系人 |
| 保存本次草稿 | `{profileId,templateId:所选公共模板id,templateVersion:所选版本,subject:本次输入,content:本次输入,selections}`，原 draftId 更新时才带 | selection.contactId 取内部联系人ID；emailKind 默认公司邮箱、个人邮箱必须显选；variables.contactName 取本次输入；冲突 variableSourceContactId 取手选联系人；confirmUnsubscribed 取逐条确认 |
| 邮箱去重/变量 | 原联系人公司或个人邮箱由 emailKind 决定；按最终邮箱小写键分组，用户选变量来源 | 同邮箱大小写合并一封；不加入 plus/dot 别名归并；缺变量、冲突来源未选择和未确认退订拒绝预览 |
| 预览及确认 | `{draftId:保存响应}` → `{previewId:预览响应}` | 不占额度、不扣查询点、不发送；预览固定本次内容及变量，公共模板不回写，内容变化旧快照需重做 |
| 确认与发送 | `{previewId,channelId:显选渠道id,confirmUnsubscribeNotice,confirmQuota}` → `{batchId:确认响应.batchId}` | 租户和操作者取会话；内部档案/联系人、mailsouId、最终邮箱从已确认快照取；预设附件取模板版本快照，档案附件不进入 |
| 渠道外部参数 | 发信地址取渠道 umail_sender_address，回复地址取固定渠道 reply_to；登录邮箱仅身份 | U-Mail organizationId/resourceId/recipientId 各取实际企业/资源/收件人ID，供应商拼写 relpy_to 保持；不传 tpl_id 覆盖本次编辑 |
| 未知/跨日 | queryId、batchId 与原 path/body 保留；无自动 execute/retry | 未知保留原日预占；未执行跨日暂停释放原日，重确认占新日；迟到证据只结算原日且幂等 |

随机夹具明确区分组织、账号、候选列表 source、内部档案 UUID、详情 data.id/持久化 detail_id、联系人内部 UUID、源 id/fileId、mailsouId、报价/草稿/预览/批次/收件人 UUID；详情的 `data.id=upstream-detail-<UUID>` 与内部档案不同。采购所在国不在本票联系人/邮件链路中，未引入国家参数或把显示国 TUR 传给联系人接口；原详情国家校验不变。参数值、选择快照、逐请求 body、预览渲染、外部调用和账务实值见 [ISSUE-55-EVIDENCE.json](ISSUE-55-EVIDENCE.json)。证据无 Cookie、CSRF、密码或供应商凭据。

## 实际验证

在 application 执行：

```powershell
npm run typecheck
node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/issue55/compiled
node node_modules/vite/bin/vite.js build --outDir .scratch/issue55/web
node scripts/verify-issue55.mjs
```

执行器创建随机名 `issue55_<random>_test` PostgreSQL 17.6-alpine 数据库和随机容器、凭据、映射端口；仅在该容器内初始化/清理，最终移除自己创建的容器及临时卷。HTTP 独占3255，Vite/代理独占3257/3256。编译、构建、扫描器及浏览器产物全部在 `.scratch/issue55`；不写共享 dist/test-results，不连接共享库，trace/截图关闭。浏览器驱动真实 Nest/HTTP/PostgreSQL，只有联系人供应商、U-Mail 发送及附件扫描边界受控。

最终浏览器专项 `1 passed (24.3s)`（测试本体21.6秒），后续串行真实 PostgreSQL/HTTP 服务层专项覆盖 company-contacts、email-preview、email-send。类型检查、独立编译/构建通过；Vite 既有 >500kB bundle 提醒保留。

实际通过场景：

- 报价前进入详情无收费调用；首/下一页报价取消不调用供应商，最高0.5000冻结授权仅 execute 才生效。首查询1次、扣0.2500，重复 execute 原 queryId 仍1次且无重复流水。
- 待核实联系人默认不选，直接API未确认归属预览409；逐条说明后显选企业邮箱，Dup/dup 同邮箱缺冲突来源拒绝；选 b 来源后只预览1个邮箱、主题 Hello Bea。显选 a 的个人邮箱后预览2个邮箱；未知变量拒绝，逐条退订默认移除，手选未再次确认拒绝，再次确认后允许。
- 保存、预览、内容确认供应商发送0调用、批次0；未确认退订提示400、日额度1但2个邮箱409，均无发信。模板附件 preset.txt 为唯一外部附件；最终个人邮箱、contactId、mailsouId、主题正文与预览一致，发信地址、回复地址和登录邮箱不同。
- U-Mail 受控未知返回2次调用、2个 uncertain；用量 reserved=2/used=0，查询点数不因邮件变化。重复 batch execute、同档案参数切换、取消/确认离开、前进后退、菜单离开返回均维持2次调用和原预占，按钮不允许重发；档案显示原 batchId 未确认提示。
- 真实账号菜单退出后业务员登录，不继承旧预览；非原发送人 execute404。业务员可以本企业联系人查看和更新。跨企业档案404、注入组织字段400；跨企业邮件执行404，平台/分销/强制改密直接API403，深链不显示目标联系人。
- 主动更新报价取消0额外调用；成功更新1次、再扣0.2500，未返回的 b 联系人内部ID保持且 not_returned_in_last_update=true，不推断离职。随后超时更新保留 queryId、冻结0.5000，重复 execute 不再调用。最终联系人供应商3次，余额9.5000/冻结0.5000，邮件仍2次且 reserved2/used0；Nest刷新、Vite深链和刷新不增加调用。
- T14真实HTTP回归供应商DTO公司名/逗号职位/页码/原枚举，跨企业拒绝、余额不足、成功结算、并发重复执行、零结果和最终失败冻结释放。
- T21真实HTTP回归同邮箱去重/退订/变量冲突、仅预设附件、附件扫描和大小数量拒绝、跨企业草稿/预览拒绝、公共模板不回写及过期内容快照确认拒绝。
- T22–T25真实PG回归 SMTP/U-Mail 共享额度及并发确认、accepted转已用、not_submitted释放、uncertain保留、资源归属错误、证据核对/乱序幂等、手动重发权限/确认、跨日暂停及并发次日确认、旧日未知与暂停混合批、迟到结果只结原日不重扣今日。

测试迭代中首轮因 Element Plus 下拉输入被占位文案遮挡超时，改点下拉外层；调整无效变量断言，遵循原“允许存草稿、预览拒绝”契约。未为了通过测试修改业务规则。最终结果以上述命令实跑为准。

## 未验证边界

未连接正式腾道、SMTP/U-Mail、真实DNS、真实邮件投递/回复/退信/黑名单和供应商附件兼容；没有正式扣费/发信。SMTP全浏览器单轮与跨日记录操作没有在本票单独重跑（共用服务层真实回归已跑）；跨日采用旧日期持久化夹具，不代表等待真实零点定时器。未执行生产HTTPS/反代、真实病毒扫描、多实例压力及跨刷新未知上下文恢复。采购所在国不属于本票链路，未扩展该业务。#52附件/人工时间线及其他票页面完整业务不在本票重跑范围。

没有运行共享 npm run build（写共享dist），使用已安装编译器独立输出；npm test/基础固定目标集成未执行，因不覆盖本票；无 lint/formatter 脚本，未安装依赖或创建自定义扫描器。最终清理兼容容器及全角色联合退出验收未执行，由剩余调用方及整批证据决定。

## 前端编码规范试点交付反馈

- 规则版本0.0.1；触发自动，使用 Vue skill。
- ACTIVE MUST FCS-007/011/013/019/021–027/030；GUIDANCE FCS-014/032。只触及请求结果识别及文案赋值，没有改依赖、样式或状态库。
- 通过：typecheck、独立tsc/Vite、真实浏览器专项、4个服务层测试、触及路径 diff 空白检查。未执行共享构建/固定无关测试、lint/formatter原因见上。
- 冲突无；存量规范债务不扩大整改；PENDING命名/顺序等沿用仓库原样，不提升为硬约束，无需澄清。
