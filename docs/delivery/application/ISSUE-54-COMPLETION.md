# Issue #54 产品词搜索与候选建档

日期：2026-10-28。实时工单：[控制台迁移 21](https://github.com/BenXueYou/ai-research-company/issues/54)，实施时为 Open；已读取工单正文及 v1.2 补充验收。基线提交 `eee101bb054c79f3e524241c03d11279587bb10a`，以当时共享工作区代码为实际基线，保留 #52/#58/#59 与并行 #53/#56 的未提交成果。

## 实现与集成边界

- 产品搜索继续由 `web/pages/companies/ProductSearch.vue` 承载，请求适配归 `web/api/productSearch.ts`。保留产品词、采购企业所在国三位代码、起止日期、页码与页大小来源及后端校验。名单、免费核实、详情分别确认，不自动翻页或批量建档。
- `/terminal/search` 的共享 `TerminalSearchPage.vue`、App 限定缓存、Router 接入及旧 CompanySearch/ProductSearch 兼容挂载移除由并行 #53 负责；本票已在其真实接入上完成浏览器验证，没有改写上述公共文件。共享页保留公司名和产品词两个模块。详情主动核实依赖 #53 将现有 `CompanyDetailService.get` 暴露为 `POST /api/company-details/status`，不另改详情业务规则。
- 页面未提交输入/报价离开可继续编辑或确认放弃；提交中阻止离开。名单或详情结果未知时保留原 `pageId`/`queryId`，经确认可离开；返回不重发，用户只读核实原请求状态。未知时不允许新报价、换候选或再次付费执行，避免覆盖原核对上下文。取消报价只清本地展示，不取消已执行业务或释放冻结。
- 建档后通过原详情报价接口取得 `localProfile.id`，显示带内部档案 ID 的档案库入口；已有本地档案同样免费进入。没有使用供应商详情 `data.id`、列表 sourceId 或候选 ID 作为档案路由 ID。
- 缓存只用于当前会话内路由切换，由共享 App 的会话 generation 销毁；不承诺刷新后恢复草稿或未知标识。刷新/离开浏览器仍有公共离开提示。分销与其他未迁移模块仍依赖兼容容器，本票不宣称其全局退出。
- 正式采购企业所在国映射仍未核实，生产未注册已核实的进口商适配器；保持报价前阻断。测试声明的 `buyerCountryFilterVerified` 仅用于受控适配器，不是正式国家映射证据。

## 迁移前后契约对照

下列来源与最终业务字段保持原实现；新增的状态读取和档案入口不改变收费提交内容。

| 用户行为 | 原来源 → 迁移后来源 | 最终请求/服务端及外部取值 | 验证证据 |
| --- | --- | --- | --- |
| 第一页报价 | 表单输入 → 同一表单输入 | `productDesc=ceramic pump,buyerCountryCode3=TUR,startDate=2026-01-01,endDate=2026-06-30,pageNo=1,pageSize=20` | 无价格/映射未核实均拒绝，调用 0；取消报价调用 0 |
| 确认本页 | 报价 `page.pageId` → 同一 `page.pageId` | execute 只提交 `{pageId}`；服务端从该组织报价记录固定 `catalog=imports` 和原选择快照 | 报价后把输入改成 `unsubmitted replacement`，上游仍收到原 `ceramic pump` |
| 下一页报价 | 已结算 page 快照 → 同一快照 | 仅页码从 1 改 2；仍是 `ceramic pump/TUR/原日期/pageSize=20` | 新报价不调用，第二次确认才调用；重复 execute 不增加调用 |
| 免费身份核实 | 产品候选 `candidate.candidateId` → 同一值 | 服务端取候选 `source_name=Trade Buyer 2` 与所属页 `buyer_country_code3=TUR`，免费调用 `name=Trade Buyer 2,countryCodes=TUR,pageNo=1,pageSize=20` | 空名单可见；返回 USA 时确认拒绝，未核实候选详情报价 404 |
| 明确核实企业 | 核实列表 `candidateId` → 同一值 | verify 只提交该企业候选 ID，sourceId 为 `list-source-54` | 与产品页、产品候选、详情查询等 ID 刻意不同 |
| 详情单独报价/执行 | 已核实企业候选 → 同一候选；报价 queryId → 同一 queryId | 最终上游 `{name:'Verified Legal Buyer 54',countryCode3:'TUR'}` | 详情报价及取消不调用；确认后独立扣 `0.1234`，重复执行仍单次 |
| 档案入口 | 以前仅提示建档 → 使用原 quote 的 localProfile 分支 | `/terminal/profiles?id=<localProfile.id>` | `detail_id=detail-data-id-54` 与内部 profile.id 不同；七种适用标识互异，页面进入正确本企业档案 |
| 主动核实 | 新只读入口 | `/product-searches/page {pageId}`；`/company-details/status {queryId}` | 切页返回、读状态、直接重复 execute 均无额外供应商调用；冻结不随导航释放 |

具体随机 UUID、逐次请求、上游载荷、账务流水见 [ISSUE-54-EVIDENCE.json](ISSUE-54-EVIDENCE.json)。前后均不新增客户端组织 ID、不猜测或替换标识映射；组织由当前服务端会话决定。

## 已执行验证

在 `application/` 运行：

```text
npm run typecheck
node scripts/verify-issue54.mjs
```

专项脚本先用 `config/tsconfig.issue54.json` 编译到 `.scratch/issue54/compiled`，Vite 构建到 `.scratch/issue54/web`；创建随机容器及随机名称 `_test` 数据库、随机 PostgreSQL/HTTP/Vite 端口，生成运行期测试密码与密钥，执行完仅移除本次容器。没有读取或清空共享数据库，没有写共享 dist/test-results。测试输出在 `.scratch/issue54/results`，不开截图或 trace。既有 T12/T13 测试原默认端口保留，专项通过环境变量注入随机端口；将此前被忽略的这两个测试源加入交付以保证脚本可复验。

| 范围 | 结果 |
| --- | --- |
| 前后端 TypeScript：`npm run typecheck` | 通过。首次运行恰逢 #56 文件写入中出现暂时语法错误，待其完成后重跑通过，没有改动其代码 |
| 专项 TypeScript 与 Vite 构建 | 通过；现有单包体积告警保留，未为此扩大重构范围 |
| `product-search.test.ts`：真实 HTTP/PostgreSQL T12 回归 | 通过：选择参数、无价格、缺国家、额外字段、余额不足、组织隔离、四位小数、并发重复、零结果、超时、候选国家不符、详情未决 |
| `detail-reconciliation.test.ts`：真实 HTTP/PostgreSQL T13 回归 | 通过：核对、退款、迟到结果、损耗费用去重及产品名单核对分支 |
| `issue54-products.spec.ts`：Chromium → 真实 Nest → PostgreSQL | 通过：完整产品查询/核实/详情建档/档案入口及已有档案分支；实际请求未被浏览器 mock |
| 导航与生命周期 | 通过：未提交离开取消保留输入、提交中阻止离开、未知经确认离开及返回不重发、主动读取状态、生产入口直达刷新、档案前进后退、Vite 直达刷新；每个入口仅一个 ProductSearch 实例 |
| 管理员、业务员、其他企业、平台、分销、临时密码 | 管理员完整链路通过，业务员真实 UI 报价并执行零结果页通过；跨企业页/候选/详情 404；平台/分销和临时态 403，路由/强制改密门禁通过 |
| 无价格/未核实映射/供应商未配置 | 通过：均不调用进口商供应商；Vite 后端未注入 importer 时保留映射阻断 |

账务及调用次数断言：初始余额 `20.0000`；第一页/第二页名单各扣 `0.4321`，详情扣 `0.1234`，零结果扣 `0.0000`；余额 `19.0124`。名单超时保留冻结 `1.0000`，平台确认失败释放，重复核对不再释放，迟到结果重复登记只落一条、不生成候选、不扣企业点数。之后新名单扣 `0.4321`、详情超时冻结 `1.0000`，余额 `18.5803`；业务员零结果执行后仍维持相同余额与详情冻结。成功名单和详情各仅一次 freeze/settle/release。最终进口商调用 6 次（两页成功、管理员零结果、名单超时、新名单成功、业务员零结果），免费核实 4 次，详情 2 次（成功/超时）；报价、取消、返回、重复执行、状态读取、已有档案查看和未配置入口均未额外调用。

## 未验证及限制

- 正式供应商国家映射、覆盖/填充率、计费证据、真实账号/账单与生产环境没有验证；仍由正式联调前置阻断，受控适配器结果不作为放行依据。
- 没有部署、重启、提交、推送、关闭工单，没有迁移历史业务库。没有重跑未触及的邮件投递、采购订单、全角色全业务回归或跨实例故障恢复。
- 新浏览器专项验证了超时形成 pending 及主动核对，尚未额外模拟浏览器丢响应、页面刷新后恢复原未知标识、详情无结果及详情人工失败后迟到的全部 UI 分支；T13 原回归覆盖相应服务端核对/迟到规则。刷新不自动重发，跨刷新恢复未实现。
- 页面仍同时显示公司名/产品词入口，公共搜索页整合由 #53 负责；本票没有改动 #53 公司名流程和 #56 邮件页。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动，已使用 Vue skill 的 Composition API/script setup 约定。
- 应用规则：ACTIVE MUST FCS-007/011/013/019/021～027/030；GUIDANCE FCS-014/032。未改依赖声明，FCS-028/029 不产生变更。
- 校验结果：前后端类型检查通过；专项编译/构建、T12/T13 与浏览器业务验收通过。package.json 未提供 lint/format 命令或对应配置，因此未执行；基础 npm test、无关 integration/e2e 未执行，因不覆盖本票或会使用共享产物。
- 冲突：无。存量规范债务：Vite 既有包体积告警，仅记录。
- PENDING：FCS-001～006/008～010/012/015～018/020/031/033～035 未提升为执行规则，沿用仓库既有命名与标签顺序，无需本票澄清。

## 原型风格样式优化（2026-10-28）

按用户追加要求，参照 `原型设计/原型V2.html` 及原型设计说明中的 B 布局（横向搜索优先），仅调整 ProductSearch 的展示结构和 scoped CSS：蓝紫色主按钮、白色卡片、细分隔线、紧凑筛选、浅蓝报价面板、候选行和档案链接。初始探索提示使用本地 SVG 装饰，不显示模拟数据或供应商状态。桌面四列筛选、中等宽度两列、600px 以下单列；保持原字段、标签、默认值、校验、点击处理与请求参数来源。

验证：`npm run typecheck` 通过；PowerShell `$env:ISSUE54_VISUAL='1'; node scripts/verify-issue54.mjs` 通过（隔离构建、T12/T13 2/2、真实浏览器 1/1）。现有专项增加可选截图分支，1440px 桌面、390px 窄屏及成功结果区截图均已实际检查，窄屏产品卡片无横向溢出；截图只含受控业务夹具、不含登录凭据，保存在忽略目录 `.scratch/issue54/product-desktop.png`、`product-mobile.png`、`product-results-desktop.png`。视觉验证不开 trace，正常无视觉标志运行仍不生成截图。更新后的 ISSUE-54-EVIDENCE.json 证明调用次数和账务断言不变。既有 Vite 大包告警保留；正式供应商、生产与其他业务模块没有新增验证。

本次自动应用 frontend-design、Vue 和 frontend-coding-standards（0.0.1）：触及模板/CSS遵循 FCS-007/011/013/014/030，未改依赖与业务脚本。类型检查、专项构建与业务验收通过；无 lint/format 配置及脚本，未执行；无关测试未运行。无规范冲突；PENDING 仍沿用先前记录，不提升执行强度。
