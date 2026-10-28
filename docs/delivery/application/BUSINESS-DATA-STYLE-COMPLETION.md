# 平台业务数据查看样式补齐

日期：2026-10-28。基线：`ae73b9b`，开始时工作区无未提交修改。

## 范围

仅修改 `application/web/pages/reports/PlatformBusinessData.vue` 的展示结构和局部样式，参考 `原型设计/原型V2.html` 的 `businessView`、浅色工作台、蓝紫色强调色、12px 圆角面板、24px 页标题及详情预览。保留既有页面位置和导入关系，没有抽取无跨模块调用方的全局组件。

补齐页标题、返回和刷新操作区、只读权限提示、组织筛选卡片、当前筛选结果数量、客户档案及邮件分区、状态标签、档案字段网格、可展开内容、空态和加载/错误展示。窄屏字段改为单列。业务状态值原样显示。

## 契约对照

| 链路 | 修改前后相同的取值及行为 | 本轮验证 |
| --- | --- | --- |
| 首载/刷新 | `props.request('reports')`，GET `/api/reports`，无 query 和请求体 | 浏览器捕获三次请求，均为 GET，无请求体和 query |
| 组织选择 | 默认 `''`；选项为 `organizations[].id`；分别与客户/邮件的 `organizationId` 严格比较 | `org-a` 显示一份档案及两名收件人，`org-b` 一份档案、无邮件，`empty-org` 两种空态；筛选不增加请求 |
| 档案详情 | key 为 `customer.id`；`formatDetail(customer.detail)` 保留原数据 | 本地档案 `profile-a`、详情 `upstream-detail`、fileId `different-file-id` 刻意不同；展开后后两者原样可见 |
| 邮件 | key 为 `recipientId`，保持收件人主题/正文快照；不合并批次 | 两条记录共享 `batch-a`，但 `recipient-a`/`recipient-b` 不同，档案为 `profile-a`，组织为 `org-a`；正文及换行保持一致 |
| 删除/停用 | 组织停用后缀、档案删除标记不变 | `org-b` 停用、`profile-b` 已删除，仍可筛选查看 |
| 失败/重试 | 失败置空 report 并展示 error；刷新禁用及加载提示不变 | 503 后清空旧记录，延迟重试展示加载状态并恢复四条记录 |

脚本区业务逻辑未改；没有新增提交、枚举映射、兜底、服务端权限或供应商调用。

## 验证与边界

在 `application/` 通过本次独立 Vite 服务（127.0.0.1:5341）运行 `node .scratch/business-data-style/check.mjs`。初始页面成功加载四条记录，但原型页标题缺失断言失败；修改后全部场景通过。使用真实 Vue 路由和 Chromium，API 由 Playwright 返回受控夹具，未访问或清空数据库。检查 1440、768、390px 无整页水平溢出，人工核对桌面及手机截图。脚本、请求证据和截图位于被忽略的 `application/.scratch/business-data-style/`。

已执行 `npm run build`（包含前端类型检查及服务端编译）和 `git diff --check`。Vue 及前端编码规范技能为自动启用；PENDING 命名/排列规则未提升为本次要求，无相关新文件命名决策。

本轮没有运行真实 PostgreSQL 端到端、真实平台账号及各角色越权拒绝、生产浏览器或供应商联调；既有权限验收见 `ISSUE-39-COMPLETION.md`，不能将该历史记录视为本次重新执行。未部署或重启已有应用服务。
