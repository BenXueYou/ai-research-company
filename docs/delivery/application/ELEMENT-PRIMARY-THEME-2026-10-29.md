# Element Plus 品牌主色对齐

2026-10-29，用户明确要求 primary 按钮及其他 Element Plus 选中样式统一为 #4356e0，覆盖此前不调整主题变量的约定。

## 修改

- application/web/styles/theme.css：集中设置 --el-color-primary、RGB、light-3/5/7/8/9 及 dark-2。默认、hover、active、禁用和淡色背景继续使用组件自身规则，不逐个组件覆盖样式，不调整尺寸、布局、边框或字体。
- AGENTS.md：同步明确主色和派生色的集中配置例外，保留默认组件尺寸约束。
- 保留工作区既有修改；不改业务代码、校验、事件、请求或参数来源。控制台自身背景配色未扩大调整。

## 验证

- application 内 node node_modules/vue-tsc/bin/vue-tsc.js --noEmit：通过。
- application 内 node node_modules/vite/bin/vite.js build：通过；保留现有 JS chunk 超过 500kB 提示。
- git diff --check：通过。
- 使用真实 Element Plus 组件隔离预览，1440/900/390px 下读取计算样式：primary 按钮、选中复选框、单选框、标签页、分页、下拉选项和日期选中均为 rgb(67, 86, 224)，即 #4356e0。同时预览禁用与 loading 按钮；已查看手机宽度截图。
- 使用生产前端构建及模拟会话，重新检查完整改密路由页的 1440/900/390px 布局，表单与操作区无溢出、无页面脚本异常。完整路由预览与隔离组件预览分别记录，不能作为真实登录或业务流程验收。
- 组件证据、脚本、计算样式和截图：application/.scratch/theme-colors/；完整页面截图沿用 application/.scratch/submit-button-style/password-*。

未运行后端、数据库、真实接口或业务 E2E；未逐一验收所有业务页面及所有组件状态。本次仅涉及主题色。
