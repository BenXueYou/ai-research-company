# Issue #52 企业档案库与档案维护页面

日期：2026-10-28。基线 HEAD `eee101b`，共享目录已有大量其他票未提交改动；本票未创建 worktree、reset、stash、部署、重启既有应用、提交、推送或关闭工单。已通过 GitHub REST 实时读取 #52 正文及 comments（无评论），工单仍为 Open；按已批准控制台迁移 Spec v1.2 与工程脚手架实施。

## 页面与集成边界

- `/terminal/profiles` 由 `web/pages/companies/CompanyProfilesPage.vue` 真实承载管理员、业务员档案列表；`?id=<内部档案ID>` 定位详情。状态、跟进日期、已删除筛选仍为原字段和默认值，筛选在页面内操作后提交，不擅自写入 URL 或全局 store。
- `components/CompanyProfileDetail.vue` 按所选内部档案 ID 复用原 `CompanyProfileEditor`、`CompanyContacts`（内含 `EmailComposer`）、`CompanyTimeline`。原组件内容与服务端业务规则未改动。列表适配放在 `web/api/companyProfiles.ts`。
- `CompanySearch.vue` 移出旧档案列表/详情及其筛选、更新逻辑，提供档案库链接。免费搜索、候选核实、详情建档的参数、默认 CHN、pageSize 20、报价及 execute queryId 来源保持不变；原点数摘要保留。兼容容器只删除这两个失效绑定：`current-account-id`、`can-delete-timeline`。产品搜索的 `profile-created → profileRefresh` 依赖继续保留。
- `router/index.ts` 为本路径绑定实际组件并移除旧 `target: company-search`；App 仅追加本页面的限定缓存并排除档案路径的兼容显示。共享文件每次修改前读取最新内容，保留 #58 MemberManagement、#59 TerminalUsagePage 及既有平台接入。本票没有修改成员、用量、邮件业务组件、Nest 或 Vite 装配；两个 History 白名单本来已覆盖该路径。
- 仍有免费/产品搜索、终端邮件/发信设置、分销组织/订单/用量依赖兼容容器，不能删除或宣称全局退出。

## 生命周期

档案页限定 KeepAlive，页面局部保存筛选和访问过的详情实例，按 session generation 销毁。同一页面 query.id 改变时每个详情的内部 ID 与实例对应，联系人/时间线不复用另一档案实例。首次选中才挂载详情；前进后退及切页返回不自动 execute、刷新报价或提交。刷新浏览器重读本企业列表和所选详情，不新增持久化草稿，既有邮件保存草稿 API 保持原行为。

详情在模块边界跟踪编辑、联系人/邮件、时间线输入，接入原公共 `useFormLeave`：取消保留，确认放弃清理未提交局部输入；提交中阻止离开。放弃后的子组件重建延后至下次展示，不因离开立即读后台。各业务请求仍通过原 session request，读取接口与 mutation 区分；pending 或 mutation 网络/5xx 结果不明时保留原 path/body（含原 queryId），阻止继续业务写入，允许确认后离开并返回核对。该限制不改变服务端结果、收费、幂等或原请求字段。

未知结果上下文只保存在本次会话的缓存内，不声称跨刷新恢复；本票没有新增查询结算/邮件发送恢复 API，未确认结果仍依赖既有业务核对路径。页面不自动重试，也不把隐藏或离开视为业务取消。

## 迁移前后契约对照

旧实现基线读取自 CompanySearch 和上述三个模块内组件，原文件快照保存于本次忽略产物 `.scratch/issue52/CompanySearch.before.vue`。服务端 `companies/controller.ts`、company-profiles/detail/timeline/attachments/contacts 与邮件预览服务均已核对，未修改。

| 用户动作 | 原字段和值来源；迁移后保持 | 服务端及结果 |
| --- | --- | --- |
| 档案筛选 | POST `company-profiles/list`，`deleted` 默认 false；非空时传 `customerStatus/followUpFrom/followUpTo`，值取各筛选输入；不提交组织 | 组织只取会话；管理员可看已删，业务员拒绝；上海日期规则、枚举不变 |
| 选择详情 | `company_profiles.id` 进入 URL `id`，在本企业筛选结果按 id 精确匹配 | 无跨企业详情降级、无 `detailId || id`；缺失明确提示 |
| 档案补充 | `profileId=profile.id`，原编辑器提供产品/需求/意向、日期转 ISO、客户状态、星级、逗号拆分 trim 的标签 | 原校验、审计、允许角色保持，详情上游标识不变 |
| 软删/恢复/历史 | 原按钮确认；`{profileId:profile.id}` | 管理员删除恢复，双方查看维护；历史及关联数据继续保留 |
| 详情主动更新 | 报价 `{profileId:profile.id}`；execute `{queryId:报价响应.queryId}` | 上游仍只接收档案对应已核实候选的 `{name,countryCode3}`，不把列表来源 ID 当详情 ID |
| 本地联系人与邮件 | `{profileId:profile.id}`；邮件原 selections 中 `contactId=联系人内部id`，`emailKind='company'` 默认等原逻辑 | `mailsouId` 只作为来源和模板变量身份，预览不创建发送批次，不占额度、不扣查询点 |
| 人工记录 | `{profileId,type,eventTime,contactOrPhone,content}`；编辑再传原 `record.id` | 组织/作者来自会话；仅本人编辑、管理员删除 |
| 档案/记录附件 | `{profileId,fileName,mimeType,contentBase64}`；挂记录时额外 `communicationId=创建记录响应.id`；下载删除使用 `attachment.id` | 原扫描/格式/容量、作者和租户校验；附件私有保存，不进入邮件模板附件 |

真实随机夹具的组织、账号、候选、query、内部档案、上游详情、人工记录、档案附件、记录附件、contactId、mailsouId、contactQuery、templateId 均刻意区分。实际值、请求选择快照与响应后的账户结果见 [ISSUE-52-EVIDENCE.json](ISSUE-52-EVIDENCE.json)，只有受控测试信息，无 Cookie、CSRF、密码或真实供应商密钥。

## 实际验证

在 application 执行：

```powershell
npm run typecheck
node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/issue52/compiled
node node_modules/vite/bin/vite.js build --outDir .scratch/issue52/web
node scripts/verify-issue52.mjs
```

`verify-issue52.mjs` 创建随机容器名、随机凭据、随机映射 PostgreSQL 端口，使用随机命名、以 `_test` 结尾的独占数据库。只清理本脚本创建的容器/临时卷，不连接开发或共享库；凭据不回显。应用独占 3252，开发 History 验证使用 3253/3254；构建、私有附件、编译和 Playwright 结果均位于 `.scratch/issue52`。本票专项配置关闭 trace 与截图。浏览器驱动真实 Nest/HTTP/PostgreSQL；只有供应商详情和附件扫描使用受控适配器，没有 mock 业务 HTTP。

最终专项 `1 passed (20.1s)`（测试本体17.7秒），typecheck 与独立编译/构建通过。已通过场景：

- 管理员、业务员共享档案查看/补充，状态 following、星级4、标签重点/出口和跟进日期真实落库；有效跟进日期筛选只返回目标，筛选无结果、非法日期范围明确报错，不把失败显示为空档案。
- 直达带内部档案 id、Nest 刷新、Vite 真实代理/History 直达刷新；同组件档案切换、前进后退；未提交离开取消保留、确认放弃返回重置；未重复挂载搜索模块。
- 人工 note 登记及作者/档案关联，业务员编辑他人记录403；档案附件上传、浏览器下载字节相同、管理员删除落库，记录附件挂载至独立 communicationId。跨企业档案维护/历史/附件请求404，客户端 organizationId 注入400；业务员删档案/附件403。
- 本地联系人显示，原联系人内部ID选择至邮件草稿/预览/确认快照；公司邮箱默认来源不变，模板变量正确；没有创建发送批次。
- 无报价配置明确失败且供应商0调用；报价取消0调用；真实供应商受控延迟期间点击其他菜单被阻止，结果返回前不离开。显式确认更新后供应商1调用、参数为 Chosen Company/TUR，上游 detail_id 更新而内部档案 id 保持。重复 execute 原 queryId 不再调用、不再扣款；余额由10到9.7500，冻结0。
- 供应商超时后 pending、冻结1保留，切页返回原状态与 queryId 保留、不自动 execute；直接重复 execute 仍 pending，供应商合计2调用，余额9.7500/冻结1，没有重复收费。
- 管理员软删除、已删除筛选、恢复；恢复后显示四条档案审计事件，人工记录及记录附件继续可见。外企业深链不显示目标档案；平台/分销角色深链回合法默认页且 API403；临时改密态不渲染档案、API403。独立浏览器上下文与会话切换不继承本票页面草稿或 unknown 状态。

首次测试中沿用了登录后保持深链的错误假设（原 useLogin 正常返回角色默认页）及不存在的帮助链接选择器；只调整测试等待和导航。补齐后真实专项多轮通过；以最终一次结果和证据为准。

## 未验证范围

正式供应商扣费、真实 SMTP/U-Mail 投递/回信、生产 HTTPS/反代、附件真实杀毒程序、容量/到期清理与跨刷新未知结果恢复未执行。联系人按页收费、全部邮件发送/退订/去重组合、WhatsApp 加密与电话重新录入等未修改分支没有完整重跑；本票保持原组件代码与服务端契约，联系人/邮件只验证本地选择到预览确认。免费搜索与建档的完整供应商调用场景未重新执行，相关原请求代码保持；原 T16 旧浏览器测试默认在搜索页直接找内嵌档案，已经不适合作为本票路由验收入口，本票专项替代其迁移场景。未以这些未执行项宣称供应商正式联调或终端全部迁移完成。

未执行共享 npm run build（会写 dist），改用已安装 TypeScript/Vite 工具独立输出；npm test/基础集成脚本目标不覆盖本票，未作为本票验收运行。没有 lint/formatter 脚本，未安装工具或增加自定义规则扫描器。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动，同时使用 Vue skill。
- 应用规则：ACTIVE MUST FCS-007/011/013/019/021–027/030；GUIDANCE FCS-014/032。依赖未变。
- 校验结果：typecheck、独立 tsc/Vite、真实专项浏览器通过；触及路径 diff 空白检查通过。共享构建/常规固定目标测试、lint/formatter 未执行原因如上。Vite 既有 bundle 大于500kB提醒保留，未扩大构建改动。
- 冲突：无。存量规范债务：原编辑器/联系人/时间线未做无关格式整改；共享文件其他票内容保留。
- PENDING：命名、顺序、缩进等未决规则沿用仓库惯例，不提升为强制要求，无需澄清。


## 原型风格样式优化（2026-10-28）

按用户“按照原型设计的风格优化页面样式”执行，参考 `原型设计/原型V2.html` 与对应设计说明。采用原型 #4356e0 蓝紫主色、浅灰画布、#e6e9f0 细边框和白色圆角卡片；宽屏列表/详情并排，800px 以下上下排列。标题、筛选工具栏、选中档案、客户状态和星级形成清晰层级；档案补充、源信息、联系人/邮件、时间线/附件各自成卡片。完整源信息采用可展开区域，原 JSON 内容不变。没有新增统计 API、请求、业务字段或全局状态；当前列表计数仅取已有 profiles.length，非企业档案总数。

触及 `CompanyProfilesPage.vue` 与 `components/CompanyProfileDetail.vue` 的展示结构及 scoped 样式，保留原表单绑定、原 request、ID 来源、默认值、枚举、校验、生命周期和提交条件。`issue52-profiles.spec.ts` 仅增加可选 `ISSUE52_VISUAL_CHECK=1` 截图与390px横向溢出检查，截图只包含本专项虚构测试资料，未截登录或凭据页面。其他会话现有改动保留，不部署、不重启既有应用。

验证：`npm run typecheck` 通过；`node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/issue52/compiled` 通过；`node node_modules/vite/bin/vite.js build --outDir .scratch/issue52/web` 通过（保留现有大包提醒）；设置 `ISSUE52_VISUAL_CHECK=1` 后 `node scripts/verify-issue52.mjs` 真实 Nest/PostgreSQL/Chromium 专项最终通过 `1 passed (20.8s)`。截图 `.scratch/issue52/profiles-desktop.png`（1440×1100）、`profiles-mobile.png`（390×844）已实际查看；窄屏文档没有横向溢出。覆盖本票既有筛选、维护、附件、邮件预览、角色隔离与详情更新收费幂等，不以构建代替流程验收。正式供应商/真实邮件投递及其他未修改业务分支仍以此前未验证边界为准。

前端编码规范试点交付反馈：规则版本0.0.1，自动触发；使用 frontend-design、Vue 技能。ACTIVE MUST FCS-007/011/013/019/021–027/030，GUIDANCE FCS-014/032；typecheck、独立编译/构建、真实专项与视觉核对通过，diff 空白检查通过。未执行共享 npm run build（避免覆盖共享dist）、固定无关纯逻辑/基础集成测试；项目无 lint/formatter 脚本，未安装工具。冲突无；存量组件格式不扩大整改；PENDING命名/顺序等沿用现有惯例，不提升为执行要求。
