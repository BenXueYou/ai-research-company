# 找企业国家搜索下拉框

## 范围与基线

2026-10-29：将 `/terminal/search` 的公司名查询国家输入改为带国旗、中文名和三位国家编码的可搜索多选框。默认中国；支持中文、英文和编码搜索。组件位于业务模块 `pages/companies/components`，国家显示目录位于本模块 `countries.ts`，SVG 国旗在 `public/flags`，附来源和许可证。未新增 npm 依赖。

工作区开始已有目录整理、分销页面和文档等未提交改动；本任务保留它们。对 `.gitignore` 仅追加测试 helper 目录例外及本任务临时产物忽略项。同步适配 issue53、role-help 和 integration-terminal 中原来直接填写国家编码的操作。

## 契约对照

| 项目 | 修改前 | 修改后 |
| --- | --- | --- |
| 默认值与放弃编辑 | `CHN` | `CHN` |
| 国家状态 | 输入框中的逗号分隔字符串 | 选择数组通过 computed 映射为原字符串；保留选择顺序 |
| 查询例子 | `name=success,countryCodes=USA,TUR,pageNo=1,pageSize=20` | 完全一致；显示“美国 USA、土耳其 TUR”，提交不含中文名或国旗路径 |
| 下一页 | 同一国家字符串，`pageNo=2` | 完全一致 |
| 校验 | 名称不得含首尾空格；国家匹配三位大写编码及英文逗号 | 原校验保留；空选择、`TR` 拒绝且不上游调用 |
| 目录外代码 | 格式合法时允许提交 | 保留自定义代码选择；仍走原校验，无编码替换或兜底 |
| 候选及详情 | 确认后的 candidateId；详情使用已确认 name/countryCode3 | 未改动；与列表条件的 countryCodes 分开 |

夹具区分查询公司名 `success`、候选名 `Selected success`、本地候选 UUID、来源 ID `list-selected-success-1`、详情 `data.id=detail-Selected success`、内部档案 UUID；列表条件 `USA,TUR`，已确认候选及详情国家 `TUR`。最终参数及上游受控适配器调用记录保存在 `application/.scratch/issue53/evidence.json`。

## 验证

- `npm run typecheck`：通过。
- `npm run build`：通过；保留现有 Vite 大包提示。
- `node node_modules/typescript/bin/tsc -p config/tsconfig.issue53.json`：通过。
- `node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue53.config.ts`：在临时独立 PostgreSQL 测试库执行，1/1 通过。使用 `.scratch/country-select/verify.mjs` 创建带时间戳且以 `_test` 结尾的新库，将该连接仅传给测试子进程，结束后删除该次新建库。原 `.env.test` 目标库因旧结构缺少 `accounts.username` 无法运行，未清理或修改它的结构。
- 浏览器使用最新生产构建（`vite build --outDir .scratch/issue53/web`）及 Vite 页面：默认中国、中文“日本”搜索、英文“united states”搜索、SVG 实际加载、多选编码、空选择及非法编码拒绝、两页参数一致、候选人工核实、详情结算、重复请求、国家冲突、零结果及未知结果恢复、两终端角色、跨租户及平台/分销/临时态拒绝、退出清理均通过。
- 检查 1440px 桌面和 390px 手机截图，手机无内容横向溢出。截图为 `.scratch/issue53/search-desktop.png` 和 `search-mobile.png`。
- `git diff --check`：通过。

role-help、integration-terminal 已适配选择操作，但本次未单独执行其整套回归。未调用正式腾道供应商，国家显示目录不证明供应商覆盖范围；未做生产环境联调。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1。
- 触发：自动；同时使用 Vue 技能。
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021～027、029、030；GUIDANCE FCS-014。无新增全局状态和依赖，FCS-028、032 无新增调整。
- 校验结果：类型检查、构建、受影响专项编译和 issue53 浏览器测试通过。未发现 lint/格式化脚本；未执行默认 policy 单测及全套 integration/e2e，因其不对应本次展示组件且涉及其他业务/测试库重置。
- 冲突：无。
- 存量规范债务：未评审未触及代码。
- PENDING：命名、标签、自闭合、缩进及块顺序等规则未升级为强制要求；沿用所在模块习惯，无依赖未决规则的实现选择，无需澄清。
