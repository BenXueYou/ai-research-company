# 必填下拉框迁移至 Element Plus

用户确认使用 ElForm 承接原生 required。本批完成前批暂缓的 7 处下拉框；前批记录见 [首批迁移](SELECT-MIGRATION-2026-10-29.md)。AGENTS.md 同步明确必填下拉框的组件校验方式。

## 变更与参数来源

以下文件路径均相对于 application/web/pages。原有字段、默认值及 payload 组装不变，仅增加选择项的必填校验和提交等待。

| 文件 | 字段与原取值来源（迁移前后相同） |
| --- | --- |
| organizations/MemberManagement.vue | role 默认为 sales，选项 sales/admin；创建请求 role=role.value |
| email/components/TeamSmtpSettings.vue | security 默认为 tls，选项 tls/starttls；useChannelForm 原 values/payload 逻辑保留 |
| organizations/OrganizationOpening.vue | kind 默认为 terminal，distributor 仍由 allowedKinds 决定显示；请求 kind=kind.value |
| organizations/PlatformOrganizationsPage.vue | 同上，平台开户请求及结果未知处理不变 |
| organizations/DistributionOrganizationsPage.vue | 同上，分销开户请求及结果未知处理不变 |
| commerce/PointOrders.vue | buyerId 仍取 snapshot.children[].id；请求 buyerId=buyerId.value，不改用账号 ID |
| email/UMailResourceSettings.vue | organizationId 仍取 organizations[].organizationId；请求 organizationId=organizationId.value，不改用 item.id |

七个现有 ElForm 绑定对应选择状态为 model；对应 ElFormItem 配置 prop 与 required rule；提交入口等待 validate，通过后进入原提交逻辑。其他原生输入的 required、格式及业务校验保持。原有 busy/凭据/pending 等入口保护在异步校验后复查；订单继续由原 run 处理提交状态。原请求核实、重试路径不重组参数。

移除原生 select 专用 CSS，保持对应控件宽度、高度、圆角，并使用 ElSelect 的焦点、禁用和校验状态样式。没有增加清空、筛选、多选或默认选项。

## 验证范围

按本次用户要求缩小验证范围，不运行功能测试。

- 静态核对：7 个文件选项 value/:value、v-for、v-if、key 与原代码一致；required 从原生 select 移至 ElFormItem 规则，其他 required 保留；人工核对原请求对象及默认值。
- application 下 `npx --no-install vue-tsc --noEmit`：通过。
- application 下 `npx --no-install vite build`：通过，有大于 500 kB 的 chunk 体积提示。
- `git diff --check`：通过。
- application/web 下原生 `<select>` 扫描：无剩余。

未运行真实提交、空值拒绝、权限/租户、账务、SMTP 发送、接口/数据库及业务 E2E 测试；未做浏览器截图验收。因此上述参数一致性和校验接入结论是静态核对结果，不代表运行时业务验收通过。
