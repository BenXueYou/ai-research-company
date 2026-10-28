# server 与 web 结构整理记录

## 基线与范围

- 基准提交：`c21b3f2`。开始前工作区已有 `application/README.md` 的未提交修改，以及未跟踪的 `AGENTS.md`、`docs/engineering-scaffold.md`；本批保留其内容。
- 只迁移 `application/server/` 的业务服务、schema、上游适配与控制器，以及 `application/web/` 的业务页面和采购 API 文件。入口 `server/main.ts`、`server/app.ts`、`server/database.ts`、`web/main.ts`、`web/App.vue` 保持原位置。
- 后端领域目录：`identity/`、`organizations/`、`commerce/`、`companies/`、`email/`、`upstream/`。服务组装在 `composition/services.ts`；鉴权守卫在 `identity/guard.ts`；各领域的 `controller.ts` 保存原端点实现。前端业务目录与上述领域对应，另有 `reports/`。
- 本批没有修改请求体字段、服务方法体、数据库 SQL、响应结构、页面提交逻辑或依赖与脚本。文件移动后的改动为相对导入路径；`app.ts` 将原装配和端点代码移出。

## 契约对照

| 链路 | 修改前来源和值 | 修改后来源和值 | 验证结果 |
| --- | --- | --- | --- |
| API 路由 | 原 `app.ts` 的 91 个 GET/POST 方法与路径 | 六个领域控制器，91 个方法与路径，集合相同 | 静态逐项比较通过；方法体按原文移动 |
| 企业搜索核实 | 浏览器选择第二个候选，`source_id = source-B-page-1`；列表查询参数为 `name = Browser Original Query`、`countryCodes = USA,TUR`、`pageNo = 1`、`pageSize = 20` | 同值、同来源；第二页仍用原搜索条件和 `pageNo = 2` | T10 浏览器场景通过；未选择前无已核实候选 |
| 联系人选择到邮件预览 | 夹具 `mailsouId = mailsou-browser`、`id = different-id-browser`、`fileId = different-file-browser`，三值不同；用户选择 `personal@browser.example`，联系人为数据库记录 ID | `recipient_snapshot.contactId` 仍为所选记录 ID；`preview_snapshot.mailsouId` 仍为 `mailsou-browser`，邮箱仍为 `personal@browser.example` | T21 浏览器场景通过；未确认归属前先填写确认说明；预览确认后尚未发信或占用额度 |
| 邮件预览到发送 | 用户明确选择 U-Mail 渠道及本企业今日额度；回复邮箱来自渠道配置 | `email_recipients` 的邮箱与 `mailsou_id` 同上；`email_batches.channel_kind = UMAIL`、`umail_resource_id = browser-resource`、`reply_to = umail-reply@example.net`；受控发送结果 `not_submitted`、额度未消耗 | T23 浏览器场景通过；没有把供应商受理解释为送达 |
| 成员、开户、渠道、采购与账务 | 请求字段由原页面、当前会话和服务端既有规则提供 | 方法体和页面逻辑未改；相同输入路径 | 隔离库的 HTTP/PostgreSQL 测试覆盖允许、拒绝、权限、幂等、账务与适配器调用，结果见下节 |

## 执行结果与边界

- 基线：`npm run typecheck`、`npm test` 通过。
- 改后：`npm run typecheck`、`npm run build` 通过；91 个路由的方法与路径静态比较一致。
- 原有 `.env.test` 指向的库带旧结构，运行 `npm run test:integration` 时 7 个数据库用例在初始化阶段因 `accounts.username` 列不存在而失败，1 个纯适配器用例通过。没有改动该库。
- 为复验创建专用、全新且以 `_test` 结尾的库；使用现有 `.env.test` 凭据，仅覆盖 `TEST_DATABASE_URL` 的数据库名。基础六文件集成套件 48 项通过，覆盖身份、组织、成员、SMTP、U-Mail 和企业搜索。附件、发信及采购补充套件 10 项通过；组织状态用例在独立新库中 1 项通过。测试结束后删除本批创建的库。
- 浏览器：T21 邮件预览、T23 邮件发送、T10 企业搜索各 1 项通过。T14 联系人逐页报价未通过：原用例的按钮定位匹配两个元素；限定到档案后仍未出现预期报价。这个失败未归因于此次目录移动，相关链路不能记为已验收。
- 未执行完整浏览器套件、所有专项数据库测试、新环境生产式 `deploy`/`start`、正式供应商账号与真实发信联调。数据库初始化只在新建测试库中验证，未对现有业务库运行部署命令。
