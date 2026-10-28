# 上游与对账页面样式交付

日期：2026-10-28（Asia/Shanghai）。

## 范围与基线

参考 `原型设计/原型V2.html` 的浅灰画布、白色卡片、蓝紫色主色、细边框、12px 卡片圆角与紧凑表格。仅改动 `application/web/pages/upstream/` 中两个路由页面及两个模块内部组件；未调整公共布局、全局样式、路由或请求适配。开始时工作区已有其他模块的大量未提交修改，均保留。

- `/platform/reconciliation`：统一标题、卡片及表格；增加选中行提示、空记录提示、错误/成功/结果未确认提示样式；核对表单桌面双列、手机单列。
- `/platform/reconciliation/upstream`：补齐页面标题；余额与有效期分区、三类调用额度卡片、最近快照信息、账户查询记录表格及空态。窄屏表格在卡片内滚动。
- 复用现有字体栈、颜色变量与按钮体系；没有新增依赖。

## 契约对照

四个 Vue 文件的 script 块与 HEAD 逐字一致。只调整模板结构、展示 class 和 scoped 样式。

| 环节 | 修改前后相同的来源与结果 |
| --- | --- |
| 查询选择 | 三类 GET 返回的行 `queryId`；不是候选 ID、内部档案 ID、上游结果 `id` 或 `fileId` |
| 核对提交 | `billingReference`、`traceId`、`evidence`、`upstreamPoints`、`result`、`outcome` 均来自原表单；默认 settled、原行初始化与空串兜底不变 |
| 失败 / 迟到 | 最终失败不传 result；迟到登记不传 outcome；upstreamPoints 仅非空传送；三类业务请求路径不变 |
| 离开保护 | 脏表单确认放弃、提交中阻止离开、结果未确认保留上下文及主动刷新核实，全部保持 |
| 上游读取 | 进入页面只 GET `upstream-monitor`；点击更新才 POST `upstream-monitor/refresh`，请求体仍是 `{}` |
| 快照 / 额度 | balance、expiresIn、fetchedAt、traceId、usage 与 limits 仍直接展示原字段；不新增阈值、点数换算或缺失补零 |

真实夹具明确区分查询、候选、档案、结果 id/fileId；浏览器逐字段比较 POST 与选择/输入，随后查询数据库验证业务结果。核对结算、真实零结果、最终失败、迟到、重复提交、参数拒绝、权限及账务均使用既有专项断言。

## 实际验证

- `npm run typecheck`：通过。
- `node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/upstream-style/compiled`：通过。
- `node node_modules/vite/bin/vite.js build --outDir .scratch/upstream-style/web`：通过，保留现有主块超过 500kB 提示。
- `node .scratch/upstream-style/run.mjs`：最终 **2/2 通过**。使用新建独立 PostgreSQL 17.6 容器，随机凭据与回环随机端口，专用 `issue46_test` 数据库，运行后移除本次容器。
- 核对场景：复用 `issue46-tests/reconciliation.spec.mjs`，覆盖三类核对与迟到、结算上限、释放冻结、留痕、幂等、400/409 拒绝、结果未知恢复、导航与四角色/强制改密。最终内部余额 96.0000、冻结 0.0000，供应商业务查询调用 0。
- 上游场景：复用 `issue45-tests/upstream.spec.ts`，覆盖加载/重载不调用上游、主动更新、令牌失效重取、更新失败后保留快照、调用计数不可用、未配置、角色拒绝和组织停用。更新请求体逐一断言为 `{}`。
- 临时测试副本适配当前工作区的账号下拉菜单和二级导航；上游跨端口测试登录前清理浏览器 Cookie，避免共享主机 Cookie 干扰身份。业务参数与账务断言保留。初次执行发现手机表格撑宽父容器，修复 min-width 后手机断言通过；旧导航选择器适配后最终两项通过。
- 1440×1050 与 390×844 截图已人工查看；手机文档无横向溢出，表单右边界在视口内。截图位于 `.scratch/upstream-style/`：`reconciliation-desktop.png`、`form-desktop.png`、`form-mobile.png`、`monitor-desktop.png`、`monitor-mobile.png`。
- `git diff --check -- application/web/pages/upstream`：通过。

本地测试脚本、编译输出、请求证据 `evidence.json` 及截图保留于 `.scratch/upstream-style/`。未验证正式供应商账号、生产环境部署及真实供应商计费；本次上游使用受控适配器，不作为正式联调证据。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1。
- 触发：自动；同时使用 frontend-design 与 vue 技能。
- 应用规则：MUST FCS-007、011、013、030；GUIDANCE FCS-014。script 与依赖不改动，其他 ACTIVE 规则未新增触及区域。
- 校验结果：类型检查、前端构建、服务端编译、真实浏览器两组专项与 diff 空白检查全部通过；独立 lint/format 未执行，项目没有对应脚本或配置；无关全量测试与部署命令未执行，因为本次只涉及两个页面的展示。
- 冲突：无。
- 存量规范债务：无新增记录；未扩大到其他模块治理。
- PENDING：既有文件命名、SFC 顺序、缩进等 FCS-001～006/012/015 未决规则不提升执行，无需澄清；沿用原目录与现有格式。
