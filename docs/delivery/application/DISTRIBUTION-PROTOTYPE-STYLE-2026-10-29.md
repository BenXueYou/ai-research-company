# 分销三个页面的原型样式对齐

日期：2026-10-29。基线提交：`d2b1823`，以开始任务时的工作区为实际基线。已有测试目录整理、工程说明及 `.scratch` 历史产物改动属于其他工作，本次保留。

## 对照结果与修改

参考 `原型设计/原型V2.html` 及其设计说明：浅灰工作台、蓝色 `#4356e0` 主操作、白色细边框卡片、12px 圆角、23px 内边距、浅灰表头，以及开户对话框的双列表单与右侧确认操作。原型展示的是演示业务；本次沿用当前应用的真实业务字段和独立路由，不复制演示账号、模拟数据或演示操作。

| 路由 | 原有差异 | 本次处理 |
| --- | --- | --- |
| `/distribution/orders` | 标题与全部内容套在大白卡内，建单区再嵌套带色卡片；标签字号与按钮偏离原型 | 标题回到工作台背景，库存拆为独立白色摘要，建单与订单采用原型卡片，统一表单与蓝色主按钮 |
| `/distribution/profit` | 缺少页面标题，导出为裸链接，表头没有浅灰底 | 补齐页面标题与说明层次，导出使用蓝色操作样式，毛利数值和六张明细表对齐原型文字、边框、间距和表头 |
| `/distribution/organizations?view=new` | 开户沿用登录卡片的单列、较大输入框与按钮规则，表单过长 | 双列组织与电话信息，邮箱独占一行，页脚说明及确认按钮分区；手机恢复单列；凭据复制操作同步使用原型蓝色 |

只修改四个业务组件的模板和局部样式。订单样式放在分销路由包装组件，避免改变平台共用 `PointOrders` 的视觉；利润表组件位于报表模块自己的 `components`；未移动文件或新增全局组件。四个组件的 `<script setup>` 保持原样。

## 请求契约对照

通过同一浏览器夹具在改动前后填写和提交，捕获的业务参数一致。测试标识故意不同：组织 `org-child-21`、账号 `account-child-83`、订单 `order-48`、流水 `ledger-73`、查询引用 `query-91`。

| 操作 | 修改前与修改后的最终参数 | 取值来源 |
| --- | --- | --- |
| 建单 `POST /api/point-orders` | `buyerId=org-child-21, quantity=17.2500, unitPrice=4.2500` | 直属组织选项的 `child.id`、数量输入、售价输入 |
| 收款 `POST /api/point-orders/confirm` | `orderId=order-48, receiptReference=receipt-dist-52` | 选中订单的 `order.id`、收款凭证输入 |
| 开户 `POST /api/organizations` | `name=新远航企业, kind=terminal, countryCode=+65, phone=81234567, email=new@voyage.test` | 五个原有表单绑定；区号提交输入值，未替换为显示名称 |

每次新页面会话的 `requestId` 随机值自然不同，前后对比仅排除该随机值；原有生成、重试复用和提交规则没有修改。利润仍由 `GET /api/reports` 读取，导出地址和文件名仍为 `/api/reports/own-ledger.csv`、`own-ledger.csv`。显示字段、原始枚举、缺失值和组织名称兜底保持原样。

夹具证据：`application/.scratch/distribution-style/before-requests.json`、`after-requests.json`。前后各三页、两种尺寸截图共 12 张，文件名为 `before/after-{orders,profit,opening}-{desktop,mobile}.png`。桌面 1440×1050、手机 390×844；已人工查看修改前桌面及修改后桌面、手机截图，确认页面无横向溢出，长表格在各自容器内横向滚动，浏览器无运行异常。

## 验证结果

- `npm run typecheck`：通过，前后端类型检查。
- `npm run build`：通过，Vue 类型检查、Nest 构建和 Vite 生产构建；保留现有大文件提示（JS 约 841kB），不扩大到拆包优化。
- `node .scratch/distribution-style/visual.mjs before`、`after`：通过，三个路由的桌面/手机渲染及建单、收款、开户请求前后逐项对比。
- `node --env-file=.env.test .scratch/distribution-style/real.mjs`：开户 issue48 与报表 issue51 通过；订单 issue50 首轮因临时配置缺少 `baseURL` 而在 `page.goto('/')` 失败，尚未进入业务操作。补齐临时配置后执行 `node --env-file=.env.test .scratch/distribution-style/real.mjs issue50`，通过。最终三个既有用例均通过，未修改其业务断言。
- issue48：真实开户、参数与落库、临时凭据交付、空格电话拒绝、跨级与伪造上级拒绝、二级分销限制、组织状态、密码重置和丢失响应重试。
- issue50：真实分销建单、改价、收款、库存不足与预留、完整划拨、退款、组织停用、角色门禁、请求结果未知与导航保护，及平台共用订单组件回归、账本结果校验。
- issue51：真实授权范围报表、自有毛利、CSV 与 SQL 对账、私有业务字段不可见、越权拒绝、错误/缺失状态、角色和会话隔离，以及桌面/手机截图与 History 路由。
- 四个改动组件的 `<script setup>` 与基线逐一对比：全部一致。
- `git diff --check`：通过。
- lint、Prettier、Stylelint：未执行，项目未配置相应脚本或配置文件。
- `npm test`、其余集成和浏览器套件：未执行，与本次样式范围无关。

数据库验证运行器在 `.scratch/distribution-style/real.mjs`，通过已有 `tsconfig.server.json` 编译已有测试，运行 issue48/50/51 三个用例。使用随机命名的独立 `_test` 数据库并清理；生成副本只将静态资源地址指向本次 `dist/web`，并将 issue51 证据重定向至本任务临时目录，未修改测试源码或历史交付证据。

未验证：生产环境、正式供应商联调和其他浏览器引擎。本次不部署。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1。
- 触发：自动（Vue 3 前端模板、样式调整）。
- 应用规则：ACTIVE MUST FCS-007、011、013、030；GUIDANCE FCS-014。脚本与依赖声明未改变，其他 ACTIVE 规则无新增适用代码。
- 校验结果：类型检查、构建、截图、请求契约及 issue48/50/51 真实数据库浏览器用例通过；首轮订单验证配置错误及修复重跑结果见上方；lint/格式化工具未配置，其他测试不相关未执行。
- 冲突：无。
- 存量规范债务：未触及的紧凑模板和脚本未作格式化整理。
- PENDING：FCS-005、006、009、010、012、015 等布局/格式约定未升级执行；沿用当前文件惯例，无需额外澄清。

## 同日补充：移除“当前上级”卡片

按用户截图反馈，参照 `PlatformOrganizationsPage.vue`，删除分销下级管理标题右侧的“当前上级 / 最多两级分销”卡片、专用样式及只供该卡片显示的 `parentName` 状态与赋值。标题区模板现与平台页一致。列表、开户、下级账户共用该标题，因此均同步生效；接口响应类型仍保留 `parentName` 字段，组织请求、权限与提交参数未改变。此项补充替代上文“四个脚本均未修改”对当前最终版本的描述；上文的对比结果仍属于前一轮验证事实。

- `npm run typecheck`：通过。
- `node .scratch/distribution-style/header-check.mjs`：通过；直属列表、开户、下级账户 × 桌面/手机共六个截图，确认卡片不存在、标题文本符合平台页、页面不横向溢出，无业务写入或浏览器异常。人工查看桌面列表截图。
- `git diff --check -- application/web/pages/organizations/DistributionOrganizationsPage.vue`：通过。
- 构建及真实数据库业务用例本次补充未重复执行：仅移除显示卡片及其专用状态，无业务逻辑变化；前一轮执行结果见上文。
- 自动应用前端编码规范 0.0.1，涉及 ACTIVE MUST FCS-007、030，样式沿用 FCS-014；冲突、增加的存量债务及新增 PENDING 决策均无。
