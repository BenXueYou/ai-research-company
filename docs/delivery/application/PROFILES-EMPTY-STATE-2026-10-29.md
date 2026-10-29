# 企业档案库空状态

仅修改 `application/web/pages/companies/CompanyProfilesPage.vue` 的无数据呈现，使用 Element Plus 缺省插图和白色卡片。无筛选时提供 `/terminal/search` 入口；筛选结果为空时引导调整上方条件。提示状态在列表成功返回后记录，编辑尚未提交的筛选条件不改变已显示结果的解释。保留原有空结果文案与所有列表、详情、权限条件。

工作区原有大量其他改动及临时产物删除，本次未处理。

参数对照：初始列表修改前后均为 `company-profiles/list`、`{ deleted: false }`；选择“跟进中”并提交后均为 `{ deleted: false, customerStatus: 'following' }`，来源仍是原筛选状态。日期及已删除选项沿用原代码，无标识映射变更。

验证：`npm run typecheck`、`npx vite build`、指定页面 `git diff --check` 通过。浏览器组件夹具（`.scratch/profiles-empty-check/check.mjs`，Chrome、受控请求返回空数组）验证初始空状态、找企业链接目标、编辑未提交不切换提示、提交筛选后的提示与链接隐藏、上述请求值以及 390px 宽度卡片无内部横向溢出。未复验真实数据库、跨租户拒绝、详情编辑、联系人和邮件业务链路；此次不修改这些逻辑。前端构建仍有大包体积提示。
