# 终端跨页面集成验收

日期：2026-10-28（Asia/Shanghai）。结论：**验收工作已执行；整体验收未通过，产品重复详情身份的档案入口存在组合缺陷。** 最终浏览器结果为 **1 passed / 1 failed**，退出码 1；不得以主链路通过替代整批放行。

## 范围与基线

基准提交 `2bf193c186d40c939494d317d40eafb459d9dd0e`，实际以共享目录当时全部现有未提交实现为验收对象。已读 AGENTS、工程脚手架、应用 README、控制台迁移 Spec v1.2、第一阶段查询/标识/结算和联系人/额度规格，以及 #52～#59 专项交付。#57 已通过 `wait_threads` 确认为 completed，并读取最终 ISSUE-57-COMPLETION.md；公共兼容退出最终状态补记于下方。

本会话只新增 `application/integration-terminal/` 下的测试、配置和 runner，以及本记录、TERMINAL-INTEGRATION-EVIDENCE.json、TERMINAL-INTEGRATION-SOURCE.json。没有修改业务源码、App/router/layout、共享 package/锁文件、其他票测试或记录；没有 reset/stash、提交推送、远端更新、部署或重启用户服务。

本次未修改 Vue 业务代码，无前端生成规则需要落地；发现组合缺陷后使用 diagnosing-bugs 的失败反馈循环，保留失败断言并核对最小成因。按明确文件分工，不实施业务修复。

## 命令与环境

在 `application/` 执行：

```powershell
npm run typecheck
node integration-terminal/verify.mjs
```

类型检查通过；runner 的独立 TypeScript 编译、Vite 构建通过。真实 Chromium → Nest HTTP → PostgreSQL 17.6，仅供应商列表、详情、联系人、U-Mail 配置/发送和渠道证据使用受控适配器，没有浏览器 API mock，没有正式查询或发信。

runner 每次创建随机名容器、随机口令、随机映射 PostgreSQL 端口和随机 `integration_terminal_<uuid>_test` 库；HTTP/Vite/代理后端使用系统分配端口。编译、构建和 Playwright 输出在独占 `.scratch/integration-terminal/`，不写共享 dist/test-results，不清空其他库。finally 仅移除自己创建的容器及卷并关闭自己的服务。截图和 trace 关闭，不记录 Cookie、CSRF、密码、密钥或数据库连接串。Vite 忽略其他 `.scratch` 构建变化，避免并行产物触发开发页面热刷新。

TERMINAL-INTEGRATION-SOURCE.json 记录运行前后 web/server/vite 配置 SHA-256 及稳定性和浏览器退出码；稳定仅表示同轮代码一致，**不表示测试通过**。业务脱敏证据只由完整执行的主场景生成，acceptance 字段明确 blocked。

## 通过的组合场景与实际结果

| 链路 | 实际执行及结果 |
| --- | --- |
| 空缓存档案库 → 公司名核实 → 明确费用 → 新档案 | 免费列表 1 次，详情 1 次；详情扣 0.3000；进入正确内部档案 ID。列表 source=`list-terminal-111`，详情 data.id=`detail-data-222`，候选 UUID、query UUID、内部 profile UUID、组织与账号 UUID 各不相同 |
| 档案 → 联系人报价/确认 → 邮件预览 | 联系人 1 次，扣 0.2500；三个联系人各有不同内部 ID、source id、fileId、mailsouId。草稿/预览/内容确认发送调用 0；变量展开后最终 subject/content/contactId/mailsouId 与预览逐个相等 |
| 档案 → 团队设置 → 返回原档案 | 管理员通过真实表单配置 U-Mail，inspectChannel 1 次；发信地址、回复地址、登录邮箱分别取独立值，资源仅服务端会话企业取得。后退回原 profile query，不重查联系人或详情 |
| 预览确认 → 单轮发送 → 记录详情 → 用量 | 初批三个地址分别 accepted/not_submitted/uncertain；发送 3 次，额度 reserved=1/used=1。批次 UUID、收件人 UUID、联系人 UUID、档案 UUID 不混用；记录链接回原内部档案。刷新与重复 batch execute 不再发送 |
| 跨日未执行 + 原日未知 → 核对/重确认 | 另建已确认未执行批次，以旧日持久化夹具模拟跨日；读取记录按既有扫描暂停 queued，释放旧日未执行预占，旧日未知继续保留。显式今日重确认仅排队、调用仍 3；刷新不执行；显式执行后调用 4，重复 recipient execute 仍 4。旧日 uncertain 经受控 delivered 证据核对，旧日 reserved=0/used=2；今日 reserved=0/used=1，无跨日双计 |
| 邮件操作 → 点数用量 | 邮件发送、核对、额度重确认、刷新和导航期间五张点数/库存/查询流水表完整快照不变；用量显示真实详情 queryId 和联系人 queryId，未使用档案 ID 替代 |
| 用量 → 账号设置 → 返回 → 成员 → 业务员会话 | 返回原用量页面；管理员创建成员，临时凭据当次可见，关闭清除；真实退出后业务员不继承旧预览。业务员可读取共享渠道/记录/档案，不能维护设置或读取成员列表；非原发送人 batch execute 404 |
| 企业切换 | 另一企业档案联系人/批次请求 404，档案深链没有原档案；用量仅显示其余额 90.0000，无原查询引用 |
| 联系人更新未知 → 用量 → 返回 | 业务员明确再次确认更新，受控超时后保留原查询和 0.5000 冻结；确认离开/后退不重查、不释放冻结，联系人合计 2 次 |
| 产品入口的生产前置限制 | 未注册已核实进口商适配器的入口，合法产品报价返回 409“映射尚未核实”；余额/冻结保持 20/0。只在另一受控测试入口注入 buyerCountryFilterVerified=true，不作为正式映射证据 |
| 受控产品 → 免费核实 → 独立详情 → 用量 | 业务员显式产品确认后扣名单费 0.4321；免费核实使用产品原国家及名称，再显式确认新候选详情扣 0.3000。新详情 data.id 与已有档案相同，数据库仅一档案，但入口缺失，详见缺陷。产品页 ID 显示于用量；新候选不自动视为免费，不更改原收费契约 |
| 生产构建入口及 Vite | 实际验证档案与邮件 query 深链、刷新、设置/成员/用量返回，以及 Vite 下五页直达刷新；开发入口不继承旧端口登录假设，独立重新登录；pageerror=0 |

最终点数余额 **18.7179**，冻结 **0.5000**：20 − 0.3000（初次详情）− 0.2500（联系人）− 0.4321（产品名单）− 0.3000（新候选独立详情）。免费列表 2、详情 2、联系人 2、产品名单 1、发送 4、渠道核验 1、渠道证据 1；导航/刷新未增加这些调用。原日/当日、各流水及不同标识的实际值见 JSON。

## 未通过：T-INT-01 产品详情成功后已有档案入口缺失

优先级 P2；影响 #54 产品搜索与 #52/#53 已有档案的组合，不是公共兼容退出导致的权限或收费规则变更。尚未修复，终端最终组合验收因此不能放行。

最小复现（真实浏览器和后端均已执行）：

1. 公司名免费列表返回企业 A，核实候选 C1，单独确认详情；受控详情 data.id=D，形成内部档案 P，query Q1。
2. 产品名单返回同一企业，显式确认名单费用后免费核实，得到不同候选 C2。不要用同名推断免费；沿原规则单独确认详情费用。
3. 详情 Q2 成功 settled，返回同一 data.id=D；数据库按 `(organization_id,detail_id)` 去重，保留原档案 P，profile_count=1。
4. 产品页面显示“企业已建档，详情扣点 0.3000；名单费独立结算”，但“进入企业档案 · Terminal Buyer”链接 count=0。期望成功结果能定位现有内部 P，不能把 D/C2/Q2 直接作为档案 ID。

独立验收断言验证 Q2.state=settled、profile_count=1 后，`linkCount` 期望 1、实际 0；保留为真正失败，不 skip、不 xfail，也不以“观察到现状”当验收通过。主场景记录业务结果；第二个测试消费同一次浏览器运行的内存观察值并判断该交付要求，不读取旧证据代替新运行。

证据成因：`server/companies/company-detail.ts` quote 的本地档案分支只关联 `p.query_id → q.candidate_id`；新候选 C2 没有关联原 P。详情写档 `ON CONFLICT(organization_id,detail_id) DO NOTHING` 保留 P/Q1。`web/pages/companies/ProductSearch.vue` 的 applyDetailResult 成功后只再次 quote(C2) 取得 localProfile，没有按已返回 data.id 定位本企业现有档案；因此新报价仍非 localProfile，链接缺失。公司名路径已有按成功 result.id 匹配本企业 detail.id 的逻辑，产品路径未覆盖该组合。

新候选独立收费是现行契约，不将第一次报价收费误标为缺陷；本发现仅针对已显式付费且 settled 后的成功结果到内部档案衔接。未尝试修改标识兜底、重新关联 query、收费/幂等或业务源码。建议由 #54 负责方在明确范围内修复，随后运行本 runner；当前失败保留作为复验信号。

## 验证边界

没有重跑每张单票的完整矩阵：档案人工时间线/附件、SMTP 完整发送、退订/重复邮箱冲突全排列、所有重发和乱序证据、采购/分销交易、强制改密全链、停用组织及晚到会话的完整矩阵沿专项/公共集成证据定位，不冒充本次执行。成员本次验证创建/关闭凭据/换角色与拒绝，不重跑重置/停用全套。跨日使用旧日期夹具，不是等待真实北京时间零点。

没有验证正式供应商国家映射、实际 DNS、SMTP/U-Mail 投递/回信/退信、真实账单、生产 HTTPS/反代、跨刷新未知草稿恢复或多实例压力；国家映射生产前置限制仍保留。本次结果不代表生产可用、全部票重新验收或整批迁移成功。

前期测试夹具修正包括按钮实际名称、同主机跨端口 Cookie、产品价格配置，以及将“跨候选必免费”错误假设改回现行独立授权规则；不是业务修复。最终失败为上述真实入口缺陷。

## 公共退出最终对齐

已只读核对 CONSOLE-COMPAT-EXIT-PUBLIC-CHANGES.md：App 删除兼容容器、通知转公共布局、有限缓存保留。本次独立编译与真实组合执行已包含这些公共变更；最终公共会话完成状态及源码一致性核对待补记，不能将进行中状态记为已完成。
