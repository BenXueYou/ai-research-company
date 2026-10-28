# Web 模块分层迁移记录

日期：2026-10-28。基线为同一工作区已有的 Vue Router / Pinia 公共基础、#34/#35/#36/#45 等未提交修改。按用户新建的 `web/api`、`web/components`、`web/pages`、`web/layout`、`web/utils` 目录迁移现有模块。本次没有修改 `web/router` 或 `web/stores` 中的文件，也没有新增业务接口或改变请求参数。

## 文件归位

| 目标层 | 迁移内容 |
| --- | --- |
| `api` | `commerce/procurementApi.ts` → `api/procurementApi.ts`，保持 GET/POST 路径与请求体构造不变 |
| `pages` | 组织开户、成员、企业搜索、产品搜索、详情核对、采购、系数、订单、用量报表、邮件记录及设置等业务入口，共 14 个 Vue 文件；另有帮助与上游监控的页面实现归入 `pages/help`、`pages/upstream` |
| 各业务模块的 `components` | 企业联系人、档案编辑、时间线与其邮件编辑器归入 `pages/companies/components`；系数通知归入 `pages/commerce/components`；上游监控归入 `pages/upstream/components`。这 6 个组件均只有所属领域调用方 |
| `layout` | 新增 `ConsoleHeader.vue` 与 `ConsoleSidebar.vue`，从 `App.vue` 提取顶栏和侧栏；仍使用原有导航描述、会话和 CSS 类 |
| `utils` | 暂无适合迁入的现有纯工具模块；保留用户新建的目录占位文件，未为填充目录而抽取业务逻辑 |

`web/components` 是全局组件目录；复查调用关系后，没有组件符合跨业务模块复用的条件，因此本轮不在其中保留业务组件。帮助与上游页面现由路由表直接从 `pages/help`、`pages/upstream` 导入；旧 `web/help`、`web/upstream` 转发目录已移除。其他业务模块的相对导入和 `App.vue` 引用已更新；业务组件正文、表单状态、请求来源及权限条件未改。

## 契约对照与验证

迁移前后代码保持以下来源：直属组织状态 `organizationId=child.id`，管理员重置 `accountId=child.accountId`；开户请求体来自表单与组件内 `requestId`，结果不明重试沿用同一值；邮件预览的 `contactId`、`mailsouId` 与收件邮箱各取原字段；上游显式刷新请求体仍为 `{}`。不同组织、账号、父组织标识和候选/联系人标识在浏览器夹具中为不同值。没有把标识字段互换，也没有改变 Cookie、CSRF、方法、枚举、默认值或校验。

使用每组全新、独立、名称以 `_test` 结尾的 Docker PostgreSQL 测试库；测试后容器已停止并删除。未触及手工开发库。执行结果：

- `npm run typecheck`：通过。
- `npm run build`：通过；现有主块仍有超过 500 kB 的 Vite 提示。
- `node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.router.config.ts`：3/3 通过，含四角色、强制改密、组织/账号不同 ID、开户丢响应同一请求体、权限拒绝、会话读取失败、401 与账号切换旧响应隔离。
- `node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.router-upstream.config.ts`：1/1 通过，含深链/刷新、显式更新请求体和受控上游调用次数、失败及无权拒绝。
- 从现有 `tests/browser/email-send.spec.ts` 制作仅把静态产物路径指向本次 `dist/web` 的临时副本执行：1/1 通过。浏览器确认 `contactId` 与 `mailsouId` 分别落入原字段，U-Mail 渠道、回复地址与额度结果正确。临时副本及配置已删除，原测试未修改。
- `git diff --check`：通过。

上述验证覆盖文件移动可能影响的导航、身份、组织、上游和邮件路径。采购、费用、订单、其他收费查询、附件及所有页面的全面业务回归未在本轮逐项运行；正式供应商与生产代理也未验证。当前路由表仍有兼容业务容器及未拆分的业务入口，目录迁移不等于全部业务路由页面迁移完成。

前端编码规范试点交付反馈
- 规则版本：0.0.1
- 触发：自动
- 应用规则：触及代码遵守 ACTIVE MUST FCS-007、011、013、019、021–027、030；GUIDANCE FCS-014、032。未改依赖声明，FCS-028/029 本次不适用。
- 校验结果：类型检查、构建、上述 5 个浏览器场景通过；格式化与 lint 未执行，项目没有相应脚本；其他业务专项未执行，见上述边界。
- 冲突：无。
- 存量规范债务：未触及区域未整改。
- PENDING：命名和标签顺序等仍未决，未作为迁移依据。

## 组件归属复核

用户进一步明确 `web/components` 只放跨业务模块复用的全局组件。逐项搜索当前引用后，原先放在该目录的六个组件均不符合条件：企业联系人、档案编辑、时间线及仅在联系人流程中调用的邮件编辑器归入 `pages/companies/components`；系数通知归入 `pages/commerce/components`；上游监控归入 `pages/upstream/components`。`web/components` 目前仅保留用户创建的目录说明文件。没有修改 Router、Pinia store、组件内部请求逻辑或业务参数。

归属调整后重新运行 `npm run typecheck`、`npm run build`、导航/身份浏览器 3 场景、上游监控浏览器 1 场景及邮件浏览器 1 场景，全部通过。测试仍分别使用新建、可丢弃的 `_test` 库，运行后停止并删除容器；邮件临时测试副本及配置已删除。`git diff --check` 通过。其余未验证边界与上文相同。

## 旧页面转发目录移除

用户解除 Router 及 store 的修改限制后，Router 的两处页面导入改为 `../pages/help/RoleHelpPage.vue` 和 `../pages/upstream/UpstreamMonitorPage.vue`，并移除旧目录里的转发组件及空目录。核对 `web/stores/session.ts` 没有引用这两个旧路径或转发组件，因此 store 无需改动。路由 URL、角色元数据、会话初始化和请求逻辑保持原样。

移除后 `npm run typecheck`、`npm run build` 通过；使用两套全新 `_test` 数据库执行导航/身份浏览器 3/3、上游独立页浏览器 1/1，均通过。上游场景覆盖直达、刷新、显式更新 `{}`、供应商调用次数及无权拒绝；帮助中心在四角色导航回归中覆盖。测试容器运行后已停止并删除。其他业务流程没有因这次导入路径调整重新执行。
