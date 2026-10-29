# 日期时间控件外观迁移（2026-10-29）

基线提交 c30a146；工作区已有下拉框迁移、搜索页面样式及测试目录整理等未提交修改，本次在现有页面上增量修改，不将已有改动计入本次交付。

## 修改及取值对照

| 页面字段 | 迁移 | 原有与迁移后值及来源 |
| --- | --- | --- |
| 产品词贸易开始、结束日期 | ElInput 原生 date → ElDatePicker date | startDate/endDate，空字符串初值，YYYY-MM-DD；报价请求继续取 source 对应日期，缺省取当前输入 |
| 档案跟进开始、结束日期 | 原生 date → ElDatePicker date | followUpFrom/followUpTo，空字符串初值，YYYY-MM-DD；列表请求仍只在有值时加入同名字段 |
| 档案下次跟进时间 | 原生 datetime-local → ElDatePicker datetime | nextFollowUpAt，本地 YYYY-MM-DDTHH:mm；保留原回填和 new Date(...).toISOString()，空值提交 null |
| 人工时间线发生时间 | ElInput datetime-local → ElDatePicker datetime | form.eventTime，本地 YYYY-MM-DDTHH:mm；保留原编辑回填、校验和转 ISO 的请求路径 |
| 系数告知生效时间 | 原生 datetime-local → ElInput datetime-local | form.effectiveAt；保留 step=1、required、禁用条件及原有 ISO 转换。保留浏览器选择器，以避免仅外观迁移改变浏览器原生必填校验 |

ElDatePicker 显式设置 value-format，禁用新增清空按钮；沿用现有 v-model、禁用条件，不修改 API、权限、标识映射或业务处理函数。移除原生日期输入专用的重复边框样式，引入日期组件 CSS，设置表单内自适应宽度及档案筛选框宽度。

## 实际验证与边界

- application 内使用本地 vue-tsc --noEmit：通过（最终样式整理后复查也通过）。首次误从仓库根目录执行 npx vue-tsc，下载的临时工具报兼容错误，随后改用应用内已安装工具。
- application 内使用本地 vite build：通过；存在大于 500kB 的包体积提示。
- git diff --check -- web：通过。
- 使用 Chrome / Playwright 对隔离组件预览做样式检查：1440px 和 390px 无页面横向溢出；390px 日历弹层 x=34、宽322，在视口范围内；查看普通、已填值、禁用及秒级原生输入外观。临时预览和截图位于 application/.scratch/date-picker-style/。
- 本次样式检查使用隔离组件预览，未验收实际登录业务页面的完整布局。
- 按用户要求未运行功能逻辑、后端、数据库、接口及业务端到端测试。上述取值对照来自源码检查，不代表提交链路已获得运行验收。
