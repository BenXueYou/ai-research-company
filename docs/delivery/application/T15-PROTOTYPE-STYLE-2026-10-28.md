# T15 企业及联系人更新区原型样式调整

日期：2026-10-28。参考 `原型设计/原型V2.html` 的浅色工作台：蓝紫侧栏、白色面板、细分隔线、紧凑的操作区和蓝紫色费用确认按钮。本次只调整企业档案内的详情更新及联系人区。

## 页面变更

- 企业详情、联系人均将最近获取时间和主动更新入口放入标题区；时间以北京时间呈现。费用确认整理成单独信息卡，显示企业/页码、最高扣点和系数，取消与确认仍是原操作。
- 联系人职位筛选、提示、列表与归属标签按原型的信息层次整理；窄屏操作按钮铺满可用宽度。联系人本次更新未返回的说明保留原业务含义。
- 补入 Element Plus 选择器组件样式，使职位及公共模板等已有选择器正常显示。相关浏览器用例改为点击可见选择器容器，保持选项与请求值不变。

## 验证

- `vue-tsc --noEmit` 和 Vite 独立构建通过。最终浏览器用例在独立 `acquisition_t15_style4_test` PostgreSQL 与 Chromium 通过 1 项，覆盖档案查看、联系人到邮件预览、详情更新报价取消/确认、实际供应商请求参数、扣点、历史保留与异企业拒绝。
- 截图已检查：[档案桌面](../../../application/.scratch/issue52/profiles-desktop.png)、[档案手机](../../../application/.scratch/issue52/profiles-mobile.png)、[联系人桌面](../../../application/.scratch/issue52/contacts-desktop.png)、[联系人手机](../../../application/.scratch/issue52/contacts-mobile.png)、[费用确认](../../../application/.scratch/issue52/refresh-quote-desktop.png)。
- 不同内部企业、用户、候选、详情、联系人和源标识在用例中取不同值；浏览器请求仍以所选档案 `profileId` 报价、以返回的 `queryId` 确认，详情供应商请求仍取已核实的 `Chosen Company` 和 `TUR`。没有改动接口字段来源、枚举、默认值、校验或提交条件。

## 未验证及并行边界

- 没有重新执行全站其他选择器的浏览器流程；全局选择器样式会影响这些控件外观。未做正式腾道联调、部署或真实移动设备测试。
- 工作区同时有其他会话修改共享文件。一次全量 TypeScript 编译读到另一个会话尚未写完的 `issue49-accounts.spec.ts` 而失败；本票随后使用仅含相关服务和档案用例的独立编译，最终通过。未覆盖或清理其他会话改动。

## 前端编码规范试点交付反馈

- 规则版本：`0.0.1`；触发：自动；同时使用 Vue 与 frontend-design 技能。
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021～027、030；GUIDANCE FCS-014、032。
- 校验结果：`vue-tsc --noEmit` 通过；Vite 构建通过；Chromium 档案业务流程通过；`git diff --check` 通过。lint/format 未执行，项目无相应脚本。
- 冲突：无。存量规范债务：未扩大处理。PENDING：文件命名与 SFC 顺序等未决规则未作为硬约束。
