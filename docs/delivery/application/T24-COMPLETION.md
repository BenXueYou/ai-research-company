# T24 邮件证据核对、可信送达与手动重发确认

日期：2026-10-27。状态：本地实现及独立 PostgreSQL、真实 HTTP/Chromium 业务验收通过；未提交、推送、部署或修改线上工单。

## 实现

- SMTP 与 U-Mail 共用逐收件人渠道证据核对边界。证据必须匹配终端企业、发送尝试、U-Mail 企业资源，并携带可靠结论的渠道证据标识。渠道未配置或核对失败时明确报错，不标记为已核对，也不开放重发。
- 已受理只显示“已提交发信服务”；只有可靠的 `delivered` 证据才显示“有证据送达”。不自动登记阅读、回复或改变客户四状态。证据检查有独立记录；重复、迟到及倒序结果不重复结算额度或回退已确认状态。
- 结果待确认须先核对且仍不明确，原发送人看到“可能重复发送”提示并明确确认后才可重发。新尝试复制原邮箱、联系人 UUID、`mailsouId`、主题正文及原批渠道身份，重新按北京时间当日剩余额度预占；原不明尝试仍保留原日预占。重发执行前核对原渠道/资源与附件有效性；重复请求沿用唯一子尝试，不再次提交。
- 系统邮件时间线依据当前证据状态显示中文结果；仍独立于人工记录，不提供人工改删。新尝试显示自己的额度日期；没有提前实现 T25 的次日未执行重确认。

## 参数来源与验证证据

| 链路 | 结果 |
|---|---|
| 选择与提交 | 浏览器夹具中列表 `list-id-browser`、详情 `detail-data-browser`、源 `id=different-id-browser`、`fileId=different-file-browser`、内部联系人 UUID、`mailsouId=mailsou-browser` 均不同；最终邮箱 `personal@browser.example` 与原联系人 UUID、`mailsouId` 在原发送和人工重发中一致。没有从名称猜测或兜底标识。 |
| 渠道与证据 | U-Mail 原批固定 `umailChannelId`、企业资源 `browser-resource` 和 `umail-reply@example.net`；证据归属错误被拒绝。SMTP 也通过同一证据及状态逻辑。受理不显示送达，未知证据不显示送达。 |
| 重发与额度 | 未核对、未明确确认、非原发送人、额度不足均被拒绝；确认后只多一次适配器调用。原不明预占与重发新预占分别留在各自额度日；重发明确未提交释放该尝试预占。重复核对及重发不重复记账。邮件流程未写入联系人查询点数流水。 |
| 时间线 | 可信送达后档案系统邮件项显示“有证据送达”；邮件项不进入人工编辑、删除接口。 |

## 已执行

- 独立 `acquisition_t24_final4_test` PostgreSQL：`npx tsc -p tsconfig.server.json --outDir .scratch/t24-dist` 后运行 `node --env-file-if-exists=.env.test --test .scratch/t24-dist/tests/email-send.test.js`，通过。覆盖 T22 SMTP、T23 U-Mail 原发送与 T24 核对/额度/重发、重复及乱序证据、无默认渠道核对能力等分支。
- 独立 `acquisition_t24_browser2_test`、端口 3144、独立 Vite 构建和 Playwright 输出：`npx vite build --outDir .scratch/t24-web` 与 `node --env-file-if-exists=.env.test node_modules/@playwright/test/cli.js test --config playwright.t24.config.ts`，通过。真实 Chromium 完成档案选邮箱、预览、U-Mail 发送、核对、明确可能重复、重发及可信送达。
- `npm run typecheck`、`git diff --check` 通过。项目没有 lint/format 脚本。T15/T18 并行改动及测试输出保留；`server/app.ts`、`.gitignore` 以实时内容增量合入。

## 未验证与跨票边界

- 未连接正式 SMTP/U-Mail 送达回执、退信或渠道查询接口。默认适配器故意拒绝把“接口未配置”算作核对完成；受控适配器结果只证明本地流程，不能证明真实收件箱投递。正式渠道联调属于 T31/T32。
- 未验证真实供应商的证据唯一性、乱序回执时序、退订/黑名单实际拒投、附件兼容、真实北京时间零点切换或多实例压力。T25 的次日未执行重新确认及混合批迟到核对仍待单独验收；本票仅验证人工重发新尝试按当天额度计数，原不明尝试保留原日占用。
- T22/T23 服务层回归在同一测试中执行，T24 U-Mail 浏览器流程通过；未单独重跑 T22 SMTP 全浏览器流程、T15 联系人主动更新或 T18 附件全链合并回归。并行改动的全量联合业务验收不由本票结论代表。

## 前端编码规范试点交付反馈

- 规则版本：`0.0.1`；触发：自动，同时使用 Vue 技能。
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021～027、030；GUIDANCE FCS-014、032。
- 校验结果：`npm run typecheck` 通过；独立 Vite 构建通过；T24 Chromium 业务流程通过；lint/format 未执行，项目无对应脚本。
- 冲突：无。存量规范债务：未扩大处理。PENDING：命名、标签顺序和 SFC 顺序等未决规则未作为硬约束。
