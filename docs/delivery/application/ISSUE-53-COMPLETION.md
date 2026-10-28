# Issue #53 公司名搜索、身份核实与详情建档

日期：2026-10-28。基线 HEAD `eee101b`。经 GitHub REST 实时读取 [#53](https://github.com/BenXueYou/ai-research-company/issues/53) 正文及 comments（0）；工单仍为 Open。遵循控制台迁移 Spec v1.2、工程脚手架和应用目录职责。共享目录保留 #52/#58/#59 与并行 #54/#56 全部改动；未创建 worktree、reset、stash、部署、重启既有应用、提交、推送或关闭工单。

## 代码与集成边界

- `web/pages/companies/TerminalSearchPage.vue` 是 `/terminal/search` 的实际路由容器，组合 CompanySearch 与 ProductSearch。App 限定 KeepAlive 包含 TerminalSearchPage，原 generation 销毁机制沿用。共享文件每次改动前读取最新内容，保留其他票路由及缓存。
- 公司业务位于 `CompanySearch.vue`，适配位于 `web/api/companySearch.ts`；没有修改 #54 ProductSearch 或产品适配、#56 邮件业务文件。两个搜索组件的旧 CompatWorkspace 挂载、仅服务它们的 `profileRefresh` key/event 桥、公司搜索 target 已移除。#54 的产品建档导航独立完成；#52 档案页不再依赖搜索组件被 key 强制重建。
- `CompanyProfilesPage.vue` 只增加选择 ID 变化且不在当前列表时的原 `load()` 调用。保持现有筛选、租户及权限，无改动 #52 编辑/联系人/邮件/时间线/附件；先访问空档案页再建档也能按新内部 ID 进入。筛选排除目标时仍按原规则提示找不到，不重置筛选。
- 新增 `POST /api/company-details/status`，严格只接受 `{queryId}`，调用已有 `CompanyDetailService.get()`。复用原管理员/业务员、启用终端、当前会话组织校验；只读查询，不冻结、结算、建档或调用上游。既有报价/execute/结算代码未变。
- Nest/Vite History 白名单原本已含 `/terminal/search` 与 `/terminal/profiles`，无新增 History 路径或部署配置。分销组织/订单/用量、终端团队发信设置仍依赖 CompatWorkspace；本票不代表全局退出。

## 生命周期

页面初次挂载只读取本企业点数摘要。免费查询仅由明确查询/翻页触发，详情仅在独立费用确认后执行；返回、激活、窗口聚焦无查询/收费重放。局部状态保留搜索条件、候选、报价、原 queryId、核实状态与档案链接，不搬入全局 store。

公共 useFormLeave 对未查询输入/未确认报价提供放弃或继续编辑；提交中阻止离开；pending/丢响应保留 queryId，允许确认离开。未知期间锁定本组件新查询/核实/报价/execute，用户主动点“核实原查询结果”仅读 status，确认 settled/zero/failed 后解除。网络/5xx 不作为失败退款，不生成新 ID。收到明确 4xx 沿用原错误并保留报价重新确认能力。缓存不跨刷新恢复；会话 generation 销毁旧企业内存，普通退出不会遗留上个账号结果。

## 迁移前后契约

改动前快照：本票忽略产物 `application/.scratch/issue53/CompanySearch.before.vue`；读取过 T10/T11 交付和实际 search/detail/controller 实现。

| 操作 | 修改前后字段、值及来源 | 服务端结果 |
| --- | --- | --- |
| 免费查询 | `name` 原始输入；`countryCodes` 原始三位大写逗号串，默认 CHN；`pageNo` 当前按钮页码，首查 1；`pageSize=20` | 腾道 `/v2/company/list`，按会话组织保存候选；内部点数 0，无自动核实 |
| 明确核实 | `{candidateId}` 仅取被点击候选的内部候选 ID | 本企业候选源 `source_id/source_name/source_country` 不变，其他候选保持 pending |
| 详情报价 | `{candidateId}` 取被核实候选；不传搜索词、source_id 或详情 ID | `name=source_name`、`countryCode3=source_country`；锁定现有 X 与最高额度；已存在档案返回 localProfile.id |
| 费用执行 | `{queryId}` 仅取本次 quote 返回；取消报价不 execute | 供应商仅接收 `{name,countryCode3}`，账户与组织来自会话；原冻结/结算/幂等及未知规则不变 |
| 入档与导航 | settled `result.id` 精确匹配本企业快照中 `profile.detail.id`；URL `id=profile.id`；本地分支用 `localProfile.id` | 不使用列表 source_id、候选 UUID、queryId 替代内部档案 ID；#52 按内部 ID 选中 |
| 主动核实 | 新只读 `{queryId}` 仍是原报价 ID | 现有 get 按组织查原状态，跨企业 404，无供应商调用及收费 |

专项刻意使用不同值：搜索词 `success`、候选名称 `Selected success`、国家输入 `USA,TUR`、选中国家 `TUR`、列表来源 `list-selected-success-1`、随机候选 UUID、上游详情 `detail-Selected success`、随机 query UUID、随机内部档案 UUID；五个标识互不相同。实际随机值、请求/响应后余额及每个调用见 [证据 JSON](ISSUE-53-EVIDENCE.json)。无生产秘密、会话 Cookie、CSRF 或密码。

## 实际命令与验证

在 `application/` 执行：

```text
npm run typecheck
node node_modules/typescript/bin/tsc -p config/tsconfig.issue53.json
node node_modules/vite/bin/vite.js build --outDir .scratch/issue53/web --emptyOutDir
node scripts/verify-issue53.mjs
```

独立编译与 Vite 产物位于 `.scratch/issue53/`，未写共享 dist 或 test-results。runner 每次启动随机 Docker 容器与随机 `_test` 数据库、密码及映射端口；测试另取随机 Nest/Vite 端口，finally 仅删除自己命名的容器和卷，不连接共用开发库。真实 Chromium → Nest → PostgreSQL，供应商仅使用注入受控适配器。

已验证：

- 默认找企业直达/刷新仅挂载一份公司及产品组件；Nest 生产构建入口、Vite 直达刷新均可用。原帮助页已有管理员/业务员“搜索与建档”指引，无需修改。
- 公司名/三位国家校验、页码 1→2→1、空列表、多候选不自动选择、选择第二候选、未核实报价拒绝。取消报价不调用供应商、不写查询流水。
- 管理员、业务员通过真实页面分别完成搜索/核实/报价/费用确认/建档/内部档案链接；先访问空档案库再建档也能定位新档案。已存在本地档案分支免费跳转。
- 上游请求名称及国家准确取候选 `Selected success/TUR`，不取搜索词/列表来源/详情 ID。内部档案 URL 指向随机内部 ID，页面显示正确企业。
- 正常查询最高 1.0000、实际 0.3000，freeze 1.0000、settle 0.3000、release 0.7000；同 query 重复 execute 不再次调用、扣点或写流水。
- `data.id=null` 零结果释放全部且余额不变；供应商超时、国家不一致、空详情保留原 pending 和冻结，不建档、不自动重试。timeout 最终失败由平台 HTTP 核对，重复核对仅释放一次。
- 提交中导航被阻止；pending 导航取消/确认、浏览器后退/前进、返回并主动只读核实均保留 queryId，无额外详情调用。
- 后端已成功但浏览器响应被丢弃：保留原 ID，主动 status 恢复成功及档案链接，没有第二次供应商调用。列表供应商失败显示错误，没有详情调用。
- 业务员读取/核实/执行允许；他企业候选/查询 404；平台/分销/强制改密 403；另企业余额 0 执行 409，冻结为 0。status 多余字段 400。页面和服务端均验证。
- 退出后登录另一企业，搜索输入、结果链接、未知 query 上下文均清空。生产与开发入口验证后，供应商详情共 7 次：正常、零结果、timeout、mismatch、missing、业务员成功、丢响应成功各 1 次。
- 最终本企业余额 19.1000、冻结 2.0000（仅 mismatch/missing）；另一企业不扣点。全部账务与参数证据随 JSON 保存；档案进入截图已人工查看。

## 校验状态与边界

最终 `npm run typecheck`、专项独立 tsc、Vite build、真实浏览器专项通过。初次类型检查曾遇并行 #56 文件移动/测试写入的暂态错误，文件稳定后重跑通过。Vite 既有 >500kB chunk 提示未扩围处理。

未运行 `npm run build`/默认 test:e2e：会写共享 dist；已以同一已安装 tsc/Vite 工具独立目录构建并由 Nest 提供验证。未运行全套固定端口/共用库旧测试、与本票无关的 npm test(policy)、部署测试。未发现已配置 lint/formatter/stylelint 脚本或配置，因此未执行这些检查。未用构建代替业务验收。

未验证正式腾道账号、真实 Redis 限流/令牌刷新、生产费用账单、生产部署、多实例故障恢复、正式邮件/联系人供应商；这些不是受控适配器专项的结论。#52 其他未改流程不重跑，#54 产品收费链路和 #56 邮件记录由对应票交付。本票未知上下文不提供跨浏览器刷新恢复；不同筛选排除新档案时保持原筛选规则。

前端编码规范试点交付反馈
- 规则版本：0.0.1
- 触发：自动（Vue 3 前端修改）；同时使用 vue 技能。
- 应用规则：ACTIVE MUST FCS-007/011/013/019/021～027/030；GUIDANCE FCS-014/032。无依赖新增，FCS-028/029 无需依赖变更；未提升 PENDING。
- 校验结果：typecheck、独立 tsc/Vite、真实专项浏览器及触及路径 diff 空白检查通过；共享 build、固定目标全量测试、lint/formatter 未执行原因见上。
- 冲突：无；只触及直接区域，未修改自动化配置或依赖版本。
- 存量规范债务：仅保留现有组件布局和本票范围外文件，没有全库整改。
- PENDING：目录/文件命名、SFC 顺序/缩进等未决项未提升为约束，无本票必须澄清事项。

## 2026-10-28 原型样式优化

参考 `原型设计/原型V2.html` 的 B 横向搜索布局与配色：主色 #4356e0，白色卡片，#e6e9f0 边线，#738095 辅助文字。TerminalSearchPage 增加页面标题说明并统一模块卡片间距；CompanySearch 调整紧凑标题/免费标记、横向条件表单、候选信息与操作对齐、浅蓝费用确认、待确认反馈、档案入口和点数摘要。390px 以下表单单列、候选操作换行、报价按钮双列；样式位于所属 SFC 的 scoped style，未修改全局 CSS 或 ProductSearch 业务文件。

本次只改 template 的展示包裹/class 与 scoped style，CompanySearch script 和 API/server 未修改。name/countryCodes/pageNo/pageSize、candidateId、queryId、result.id→profile.detail.id→内部档案 ID、默认 CHN/20、权限、校验、提交条件和生命周期沿用本票上文契约。展示箭头 aria-hidden，不改变链接含义。

实际验证：在 application 执行 `npm run typecheck`、`node node_modules/typescript/bin/tsc -p config/tsconfig.issue53.json`、`node node_modules/vite/bin/vite.js build --outDir .scratch/issue53/web --emptyOutDir` 和 `node scripts/verify-issue53.mjs` 均通过；真实 Chromium/Nest/PostgreSQL 专项 1/1（25.1 秒）。沿用不同 ID 夹具并完整重跑上文公司搜索/核实/取消/费用确认/成功建档/本地档案/零结果/超时/国家不一致/空详情/无余额/重复/租户角色/丢响应等链路，详情调用仍为7次，最终余额19.1000、冻结2.0000，未改变收费。

已人工查看 `.scratch/issue53/search-desktop.png`（1440×1000）和 `search-mobile.png`（390×844）；新增窄屏卡片 scrollWidth<=clientWidth 断言通过。截图为实际真实测试页面，测试数据非生产。未重跑产品独立全流程、#52 其他维护流程或正式供应商；未部署/重启/写共享 dist/test-results。

前端编码规范试点交付反馈（本次样式增量）
- 规则版本：0.0.1；触发：自动。
- 应用规则：ACTIVE MUST FCS-007/011/013/030；GUIDANCE FCS-014；其余脚本/依赖规则无新增触及；使用 vue 与 frontend-design 技能。
- 校验结果：typecheck、独立 tsc/Vite、真实业务专项、触及路径 diff --check 通过；未执行共享 build/default e2e（共享产物/固定环境）、policy test（不相关）、lint/formatter/stylelint（未配置）。
- 冲突：无；存量规范债务：本次未扩围处理；PENDING：未提升命名/缩进等未决规则，无需澄清。
