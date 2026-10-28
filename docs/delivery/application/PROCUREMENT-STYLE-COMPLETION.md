# 采购与费用页面样式调整

日期：2026-10-28。范围：`/platform/ledger/procurement`，仅调整本模块呈现及明细浏览。

## 基线与契约

- 基线：当前工作区 `PlatformProcurement.vue`；该文件调整前无未提交修改。其他页面、公共样式及测试产物已有改动，不计入本任务。
- 页面继续放在 `web/pages/commerce`，仅本模块使用的组件放在其 `components` 目录。无路由、请求适配、服务端、全局样式变更。

| 链路 | 修改前后保持一致的来源与请求契约 |
| --- | --- |
| 采购用途 | `purchase.purpose` → POST `procurement/purchases.purpose`，默认 `sale`，保留四种用途 |
| 点数、金额、凭证、依据 | 原表单字符串 → `upstreamPoints/amount/receiptReference/evidence`；保留 required，不加入转换或默认值 |
| 关联费用 | 用途一致的 `snapshot.expenses[].id` → `purchase.expenseId` → POST `expenseId`；仅非销售且有值时携带 |
| 费用 | 原 `expense` 表单 → POST `procurement/expenses` 的 `purpose/amount/sourceReference/evidence`，默认 `failure` |
| 三种损耗关联 | 分别从原输入读取 `detailLossQueryId/contactLossQueryId/productLossPageId`；仅非空携带，不替换标识、不互相兜底 |
| 提交、重试、权限 | 原 `submit`、幂等 requestId、unknown 原载荷核对、离开保护、会话权限及服务端事务不变 |
| 明细与金额 | 原 snapshot 字符串直接显示；不使用 JS 浮点重算金额或差额，不新增账务写入 |

## 验证

所有命令在 `application/` 执行，均使用既有依赖。

| 校验 | 结果 |
| --- | --- |
| `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit` | 最终通过。首次执行曾遇到其他任务移动中的邮件页面导入缺失，未修改其文件，后续重跑通过 |
| `node node_modules/typescript/bin/tsc -p config/tsconfig.issue41.json` | 通过，编译现有采购专项测试与服务端到隔离目录 |
| `node node_modules/vite/bin/vite.js build --config config/vite.issue41.config.ts` | 通过，隔离静态构建 |
| `node .scratch/procurement-style/run-regression.mjs` | 最终通过，1 个完整真实 HTTP/PostgreSQL/Chromium 场景，14.8 秒；临时 runner 复用现有 verify-issue51.mjs 的专用容器机制，仅将目标改为已有 issue41 配置 |
| `node node_modules/vite/bin/vite.js build` | 通过，更新本地 `dist/web` 页面资源；存在构建工具的大包体积提示，无构建错误 |
| `git diff --check -- <本次四个文件>` | 通过 |

浏览器实测：销售采购；三种损耗来源的费用登记及原标识落库；用途匹配的关联充值；补足额度不关联时沿用现有行为；重复来源、错误用途、多损耗关联、缺费用关联及无权限请求拒绝；采购和费用响应丢失后的原请求核对；已记账但刷新失败的提示；dirty/submitting/unknown 离开保护；退出换账号销毁缓存。库存、资金支出及费用去重均保持原结果，未调用供应商。

新增浏览验证：1440px 双卡等宽并排；390px 单栏，无浏览器或业务容器横向溢出；三组明细页签均可见、桌面在同一行、键盘方向键可聚焦；页签与复制操作零额外请求；费用原 ID 成功复制；非零差额保留原数值并提示需核对；输入值 `98.7654` 经窄屏页签切换保持原样。截图人工检查：`desktop.png`、`forms-desktop.png`、`mobile.png`、`expense-mobile.png`、`records-mobile.png`，位于 `application/.scratch/procurement-style/`。发现初版页签组件样式未引入，已在本页面局部导入修正并完成复验。

业务函数 `refresh/submit/expenseValues/retry/purchaseValues/reload/discard` 与修改前保存的文件逐段比对一致。原表单状态、枚举、required、条件关联和幂等规则不变。最终证据 `.scratch/issue41-evidence.json` 包含实际浏览器请求与数据库快照。


## 本次实际参数证据

测试数据库 `issue41_2ceef70da8724e1cb37d6b8342a65b99_test`（独立临时容器，结束后已清理），不是开发库。

| 表单 / 选择来源 | 实际最终请求及数据库核对 |
| --- | --- |
| 销售采购表单 | `purpose=sale, upstreamPoints=10, amount=40, receiptReference=SALE41, evidence=supplier receipt verified`；无 expenseId；X=3，生成内部点数 30.0000，库存从 10.0000 到 40.0000，成本 1.5000 |
| 企业详情损耗输入 | `detailLossQueryId=f8db5566-2fcd-4d8f-9d70-72497718e6c6`；sourceReference=DETAIL41，amount=7；请求值等于相应损耗列落库值，其余两个标识字段省略 |
| 联系人页损耗输入 | `contactLossQueryId=86521261-a5dc-4fe7-824c-f7cd1ace904c`；sourceReference=CONTACT41，amount=7；请求值等于相应损耗列落库值，其余两个标识字段省略 |
| 产品名单页损耗输入 | `productLossPageId=d244e0ba-2a54-4b4c-84e3-64085b87f496`；sourceReference=PRODUCT41，amount=7；请求值等于相应损耗列落库值，其余两个标识字段省略 |
| 费用下拉 option.value | `2f421647-9b1f-4076-8269-3f8d6dc949d9` → POST expenseId → 数据库 expense_id 同值；采购自身 ID 为 `48c697ca-73df-4967-83c2-082dc0b41aaf`，明确不同；两次各 5 元充值后原费用仍为 7.0000，充值合计 10.0000，核对差额 3.0000 |

最终：库存 70.0000、移动加权成本 1.4286；累计采购上游点数 60.0000、资金支出 104.0000、平台费用 37.0000；6 笔采购、11 条流水，供应商调用 0。

## 边界

- 本次未进行真实供应商账单、生产环境、正式邮件渠道或无关模块完整回归；使用独立夹具验证，未操作开发/生产数据库。
- 未安装依赖、未修改全局样式或工程配置；无提交、推送或生产发布。
- 测试和截图产物位于被忽略的 `.scratch`；可审阅的测试扩展在原 `verification/issue41-procurement.spec.ts`。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1。
- 触发：自动；同时应用 frontend-design 与 vue。
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021～027、030；GUIDANCE FCS-014、032；VERIFY 采用既有 Vue/TS/Vite/Playwright 入口。
- 校验结果：最终类型检查、专项服务端编译、隔离及本地前端构建、真实采购浏览回归、diff 检查通过，具体命令与首次失败原因见上表。
- 未执行：无格式化/lint 脚本可用；未执行无关默认集成和全库 E2E，采购行为由相关专项真实测试覆盖。
- 冲突：无。
- 存量规范债务：未触及区域未审计；未扩大到公共样式和其他正在修改的模块。
- PENDING：命名、块顺序、缩进等 FCS-001～006、008～010、012、015～018、020、031、033～035 不提升为强制规则；沿用既有结构，无需澄清。
