# Element Plus 下拉框首批样式迁移

日期：2026-10-29。本次用户明确要求只改样式、不测试功能、缩小验证范围。

## 开发约束

仓库根目录 AGENTS.md 新增 Web 下拉框组件约束：统一使用 ElSelect / ElOption；保持值类型、默认值、空字符串选项、禁用条件与事件；不能以组件同名 required 属性替代原生约束。明确纯样式任务的验证范围及交付边界。

## 范围与基线

本批迁移 6 个文件、10 处下拉框。工作区原有 CompanySearch、ProductSearch、TerminalSearchPage、测试及临时视觉材料改动；本批以开始时的工作区为基线，只在 TerminalSearchPage 追加下拉框、导入和对应样式改动，未将原有搜索页设计修改计入迁移成果。

| 文件（application/web/pages 下） | 选择状态及前后取值来源 |
| --- | --- |
| companies/TerminalSearchPage.vue（2 处） | searchMode，product/company；只切换原有搜索模块 |
| companies/CompanyProfilesPage.vue | statusFilter，空字符串/lead/following/replied/invalid；原 load 组装筛选参数不变 |
| companies/components/CompanyProfileEditor.vue（2 处） | customerStatus 枚举不变；starRating 仍为 String(star)，空字符串仍表示未设置；原保存转换不变 |
| commerce/PlatformProcurement.vue（3 处） | purchase.purpose、expense.purpose 原枚举不变；purchase.expenseId 仍取 snapshot.expenses 中同用途 item.id，空字符串选项和原 expenseValues/purchaseValues 提交组装不变 |
| commerce/components/PricingSettings.vue | pricing.evidenceType，supplier_verified/controlled_test；原提交组装不变 |
| upstream/components/DetailReconciliation.vue | form.outcome，settled/zero/failed；原 submit 请求组装不变 |

ElOption label 复用原选项文本或插值表达式；显式 empty-values=[null, undefined] 保留空字符串选项标签。未添加 clearable/filterable/multiple；沿用原 v-model、禁用条件、选项值与显示条件。移除对应原生 select 样式，由 Element Plus 提供交互状态，页面保留原控件高度与圆角。

## 本批保留

以下 7 处有原生 required，若直接替换可能移除浏览器的提交阻断。本次仅样式范围内不迁移：

- organizations/PlatformOrganizationsPage.vue、DistributionOrganizationsPage.vue、OrganizationOpening.vue：组织类型。
- organizations/MemberManagement.vue：成员角色。
- commerce/PointOrders.vue：直属买方。
- email/UMailResourceSettings.vue：终端企业。
- email/components/TeamSmtpSettings.vue：加密方式。

后续迁移应先设计等价校验，并纳入对应的校验和提交验证，不通过删除 required 来完成替换。

## 验证边界

- 静态对照：6 个文件业务 script 除 Element Plus 导入外保持原样；10 处选择框除组件类型和 empty-values 外，原始属性绑定逐项一致。
- 人工核对：选项标签、value、枚举、动态选项来源、禁用条件及对应尺寸样式。
- application 下执行 `npx --no-install vue-tsc --noEmit`：通过。
- application 下执行 `npx --no-install vite build`：通过；有产物 chunk 超过 500 kB 的体积提示，本批不扩展打包优化。
- `git diff --check`：通过。
- 首次误在仓库根目录执行 npx vue-tsc，触发临时工具下载且因工具版本兼容失败；随后改用 application 已安装工具执行，未更改项目依赖或锁文件。

未运行功能测试、接口/数据库测试、业务 E2E、真实发送或账务操作；未做浏览器截图验收。本记录中的参数一致性为代码静态证据，不代表真实业务流程已验收。
