# 业务表单恢复 Element Plus 默认外观

2026-10-29。用户要求移除业务对 Element Plus 的外观覆盖，包括高度、宽度和内部响应样式，以整张表单为单位调整；随后补充将混用控件全部统一为 Element Plus。继续遵循本次会话“不测功能、缩小验证范围”的要求。

## 基线与范围

以本轮开始的工作区为基线，保留既有必填下拉框迁移及其 ElForm 规则、validate 等待、提交锁和参数来源。开始时已有 AGENTS.md、订单、成员、组织开户、SMTP/U-Mail 等未提交改动；本记录只归属本轮追加的默认样式、字段容器与原生业务控件统一工作。

- 覆盖现有业务页的表单、筛选、业务操作按钮，以及登录/改密表单；清理输入、下拉、日期、按钮、复选框、表单项、提示、缺省态等组件的业务外观覆盖和失效原生控件规则。
- web/styles/theme.css 移除 --el-* 主题覆盖，保留控制台自身品牌及页面变量。
- 样式入口统一完整引入 element-plus/dist/index.css。排查中确认原入口只引入 ElForm，没有独立的 ElFormItem、Checkbox 等默认样式，原业务 CSS 曾掩盖缺失；完整入口保证默认标签间距、校验提示、复选框及关联弹层样式齐全。
- 新增 web/styles/forms.css，只处理整张表单的网格、字段组、说明区及操作区。默认控件宽高由 Element Plus 决定，不再穿透修改 wrapper/inner；日期默认宽度保留，不强行拉伸到输入框宽度。
- 搜索方式统一为 ElFormItem，单独成行；搜索条件两列排列，按表单容器宽度切换单列，不再由 TerminalSearchPage 覆盖子表单内部网格。
- 档案筛选统一为 ElForm / ElFormItem / ElButton / ElCheckbox；渠道默认选项统一为 ElCheckbox；档案详情、帮助、复制编号等业务操作统一为 ElButton。截图仍可点击放大，新增默认按钮承载同一预览入口。
- 时间线的 3 个原生 file input 保留并隐藏，通过 ElButton 触发。原 change Event、File 来源、禁用条件、清空 input.value 和上传函数均保留；本轮新增 openFilePicker 仅负责触发对应原生输入。
- 业务页面不再保留可见的原生 button/input/select/textarea/label/form。控制台导航、侧栏开关及遮罩等布局交互不属于本轮业务表单替换范围。
- AGENTS.md 增补默认组件外观及整张表单布局约束。

## 契约静态对照

38 个变动 Vue 文件的 script 除组件/CSS 导入和文件选择触发器外保持原样；v-model、:value、@submit.prevent、@change 的表达式及数量逐项一致。原 :disabled 保持，另为 3 个文件选择触发按钮追加同一个 busy 禁用条件。

| 链路 | 修改前后保持的来源和取值 |
| --- | --- |
| 组织开户 | kind.value，terminal/distributor 原枚举与 allowedKinds 显示条件；组织名称、电话、区号、邮箱、requestId 组装不变 |
| 成员角色 | role.value，sales/admin 原枚举；姓名、邮箱、requestId 组装不变 |
| SMTP / U-Mail | security.value 为 tls/starttls；defaultChannel 保持布尔值；原 useChannelForm payload 与恢复/未知结果逻辑不变 |
| 点数订单 | buyerId.value 仍来自 snapshot.children[].id；数量、售价和 run 路径不变 |
| U-Mail 资源/额度 | organizationId 仍来自原 organizations[].organizationId，不替换为其他 id |
| 搜索与筛选 | 国家三位代码、searchMode、日期 value-format、statusFilter、followUpFrom/To、showDeleted 原绑定与查询组装不变 |
| 档案与时间线 | profileId、record.id 和原上传处理保留；选择的 File 仍来自原 change Event.target.files[0] |

这些是源码静态证据，不表示真实业务链路完成运行验收。

## 实际验证

- application 内 `npx --no-install vue-tsc --noEmit`：通过。
- application 内 `npx --no-install vite build`：通过；仍有 JS chunk 大于 500 kB 的提示。完整默认 CSS 会增加样式包体积，本批不做按需裁剪。
- `git diff --check`：通过。
- 浏览器布局核对：使用实际 Vue 组件、隔离请求夹具及对应控制台内容宽度，覆盖 12 个组件/页面 × 1440、1140、768、390、320px，共 60 组；全部成功渲染表单，无页面或表单横向溢出。
- 核对组件：终端搜索、档案筛选、成员管理、组织开户、SMTP、U-Mail 域名、U-Mail 资源、邮件日额度、点数订单、计价设置、档案编辑、时间线。
- 上述普通输入、选择、日期、复选框及按钮测得高度均为默认 32px；日期 wrapper 与外层高度一致。已查看搜索中间宽度、320px 及 SMTP 390px 截图。
- 夹具脚本、尺寸结果和截图在 application/.scratch/form-defaults/；最终结果为 layout-results.json。未调用真实写接口。

## 未验证范围

未运行功能逻辑、后端、数据库、接口、权限/租户、账务、真实文件上传、邮件发送、业务 E2E 和登录后的完整角色流程；没有实际提交校验表单。布局预览使用实际组件与模拟数据，不等同于生产数据和完整控制台页面验收。动态长选项、多选多行、错误提示展开、所有弹层及各业务状态未逐项视觉验收。
