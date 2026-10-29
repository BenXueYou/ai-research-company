# 表单主提交按钮与操作区整理

2026-10-29。按已确认方案执行，仅调整前端按钮外观与容器布局。

## 基线与修改

以本轮开始时的未提交工作区为基线，保留此前的下拉必填校验、默认组件样式、日期控件及目录调整。未提交、推送或创建 PR。追加修改为 22 个 Vue 文件、公共 forms.css 和本记录；本轮前的源码快照与差异核对保存在 `application/.scratch/submit-button-style/baseline.json`。

重新核对得到 26 处 `native-type="submit"`。全部使用 Element Plus `type="primary"`，每张表单保留一个主提交按钮，操作区位于表单末尾，主操作在前、原有次操作在后。取消、刷新、文件选择和删除等其他按钮未改为主色。

- 公共 `.form-actions` 跨整行、左对齐、允许换行、gap 12px；相邻按钮 margin-left 归零，避免与默认按钮间距叠加。
- 开户和登录的说明文字放到操作区之前；分销开户移除原分散对齐及手机纵向拉伸规则。
- 采购移除局部右对齐，两个操作区由 footer 改为 div，避免继承全局页脚的 20px 内边距和文本样式。
- 仅移除提交按钮上的无定义类名 primary-button、settings-primary、member-primary、contacts-quote-button；已检查 web 样式与 tests 引用，没有依赖这些类名的测试。凭据复制等非提交按钮上的原类名保留，未扩展本次操作范围。
- 不覆盖组件宽高、内边距、字体、边框、圆角或交互状态，不调整主题与 loading 逻辑。

## 文件清单

- `application/web/App.vue`
- `application/web/pages/commerce/CoefficientChanges.vue`
- `application/web/pages/commerce/PlatformProcurement.vue`
- `application/web/pages/commerce/PointOrders.vue`
- `application/web/pages/organizations/DistributionOrganizationsPage.vue`
- `application/web/pages/organizations/MemberManagement.vue`
- `application/web/pages/organizations/OrganizationOpening.vue`
- `application/web/pages/organizations/PlatformOrganizationsPage.vue`
- `application/web/pages/login/LoginPage.vue`
- `application/web/pages/companies/ProductSearch.vue`
- `application/web/pages/companies/CompanyProfilesPage.vue`
- `application/web/pages/companies/CompanySearch.vue`
- `application/web/pages/email/UMailResourceSettings.vue`
- `application/web/pages/email/PlatformEmailQuota.vue`
- `application/web/pages/upstream/components/DetailReconciliation.vue`
- `application/web/pages/email/components/TeamUMailSettings.vue`
- `application/web/pages/email/components/TeamSmtpSettings.vue`
- `application/web/pages/companies/components/CompanyTimeline.vue`
- `application/web/pages/companies/components/CompanyProfileEditor.vue`
- `application/web/pages/companies/components/CompanyContacts.vue`
- `application/web/pages/companies/components/EmailComposer.vue`
- `application/web/pages/commerce/components/PricingSettings.vue`
- `application/web/styles/forms.css`

## 业务契约静态对照

本轮相对工作区基线，22 个 Vue 文件的 script / script setup 逐字一致。26 个提交按钮去除 class/type 和空白后逐项一致；原 disabled、loading、文案、事件及表单提交绑定保留。AST 核对确认全部提交按钮为 primary 且直接位于 form-actions 内。请求构造、标识映射、值来源、校验条件和提交锁未改动。

因此改密的会话账号与密码字段，开户的 kind/区号/电话/邮箱，成员的 role，订单的 buyerId（原 children[].id），邮件的 organizationId，档案的 profileId、联系人标识与时间线 recordId，以及采购、计价、核对的原表单值，修改前后仍由相同脚本构造，未添加兜底或字段替换。本次没有发送真实请求验证最终参数值；这些是源码证据，不是业务链路验收。

## 实际检查

- `application` 内 `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`：通过。
- `application` 内 `node node_modules/vite/bin/vite.js build`：通过；保留现有大于 500 kB 的 JS chunk 提示。
- `git diff --check`：通过。
- 临时审计：`node .scratch/submit-button-style/audit.mjs`：26 处提交入口、22 个 Vue 文件检查通过；没有新增镜像实现的单元测试。
- 使用生产前端构建、独立本地静态服务、Chrome 和模拟会话/数据核对实际路由页面；所有 API 被拦截，不连接真实后端。覆盖登录、完整改密页、平台/分销开户、采购及费用、计价及系数、额度、U-Mail 资源、成员、产品/公司名搜索、档案筛选/编辑/联系人/草稿/时间线、团队两类渠道、订单建单/调价/收款/退款和人工核对表单。
- 19 组页面/状态 × 1440、900、390px 三档，共 57 组；另补充改密、档案和退款页的 320px，共 60 组。包含档案编辑 loading 展示。按钮高度为默认 32px，操作区 gap 为 12px、相邻按钮 margin-left 为 0；检查表单与操作区横向溢出、长按钮文案和左对齐。截图在完整页面内滚动到操作区后保存，没有将隔离组件图当成完整页面。
- 最终 60 组均无页面脚本异常，表单与操作区无横向溢出；320px 改密与草稿按钮实际换行，维持左对齐和 12px 行间距。已查看 390/320px 改密、390px 采购费用、900px 联系人、390px 草稿及 loading 状态截图。
- 证据脚本、逐项尺寸及截图位于 `application/.scratch/submit-button-style/`；尺寸文件为 `layout-results.json`。截图包含普通主按钮、禁用状态及档案保存的 loading 图标。loading 仅在拦截请求的页面夹具中保持，用于观察外观，没有进行真实保存。

## 未验证范围

模拟会话进入的完整路由布局，不等同于真实登录、真实数据及全业务流程验收。旧兼容组件 OrganizationOpening 的独立挂载没有单独视觉验收；已核对源码结构和类型检查。未逐项验证所有动态状态、校验错误展开与每个按钮的 loading 状态。

未运行后端、数据库、真实接口、账务、权限/租户、供应商、邮件投递、真实附件上传或业务 E2E，也未验证提交成功/拒绝结果。本轮不改变这些业务契约，以上静态检查与布局证据不能替代业务验收。
