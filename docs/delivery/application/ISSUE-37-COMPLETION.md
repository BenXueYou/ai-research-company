# Issue 37 平台直属下级管理交付记录

日期：2026-10-28（Asia/Shanghai）。状态：功能补齐并通过本票本地验收；未部署、提交、推送或修改 GitHub 工单。

## 实现及生命周期

以共享工作区已有的 `PlatformOrganizationsPage.vue`、路由及缓存接入为基础增量完成；保留 #35、#40、#43、#44、#46 等其他会话修改。页面归属 `web/pages/organizations`，不新增无跨模块调用方的全局组件，不改变服务端业务接口或数据库结构。

- 列表 `/platform/organizations`，开户 `/platform/organizations?view=new`，详情 `/platform/organizations?id=<组织UUID>`，支持直接访问与刷新。详情的“点数订单与售价”链接进入既有 `/platform/ledger`，由订单页选择直属买方并按既有规则定价。
- 平台移除旧兼容开户组件的挂载，分销保留。缓存仅限现有页面实例，会话退出销毁业务状态；不持久化密码或草稿。
- 未提交内容离开可继续编辑或确认放弃。公共离开保护 `useFormLeave` 承载路由与浏览器卸载；未知结果设置 `retainUnknown: true`，切页不清空请求上下文或自动提交。
- 开户响应丢失后保留原字段与请求 ID，冻结输入，允许人工刷新列表核实及使用原请求重试。已落库重试返回409且只创建一次；用户明确确认核实后结束本次开户，才清空表单并生成下一请求 ID。
- 重置响应丢失后保留未知状态并禁止再次重置，切页返回不重发；明确核实并确认补发后才允许用户再次主动操作。未新增状态查询或密码回放接口。
- 临时凭据只在当前交付视图显示，关闭或确认放弃后清除；刷新不恢复。未知状态及请求 ID 不保证跨刷新恢复，页面保留浏览器卸载提示。这符合本次不新增持久化的范围。

## 契约及实际值

迁移前对照见历史 `ISSUE-37-PROGRESS.md`；本轮完整选择快照和请求体见 [ISSUE-37-EVIDENCE.json](ISSUE-37-EVIDENCE.json)，只含测试标识及参数，不含密码、会话或密钥。

| 链路 | 前后来源 | 本轮断言及结果 |
| --- | --- | --- |
| 开户 | 页面 name、kind、countryCode、phone、email、requestId；上级只取服务端会话 | terminal、+86、13937001234、browser37@example.com；无空格校验、电话及邮箱重复409；组织和管理员同时落库，24字符密码、有效期大于71小时且不超过72小时 |
| 停用/恢复 | 被选列表项 child.id → organizationId；active取反 | 请求UUID与真实组织UUID相同，和管理员账号、父组织均不同；停用旧会话401，余额7.0000保持，恢复成功 |
| 管理员重置 | 同一列表项 child.accountId → accountId；主动操作生成requestId | 目标真实管理员账号，和组织UUID不同；旧会话401；凭据关闭、刷新后不再显示 |
| 开户丢响应 | 真实请求完成后丢弃响应，原输入与requestId随页面缓存保留 | 切页返回不自动重发；手动原请求重试409；组织及账号各一条 |
| 重置丢响应 | 真实重置已提交后丢弃响应 | 记录累计两条（一次正常重置、一次明确主动重置后丢响应）；切页返回数量保持，按钮禁用；没有第三次自动操作 |
| 权限 | 原服务端直属及层级判断 | 平台跨级、分销非直属重置/状态操作403；二级分销不得再开分销；终端开户/跨企业重置403；匿名401、强改态403 |

## 实际执行

使用用户已启动的 PostgreSQL 实例，在其中创建全新专用库 `acquisition_issue37_20261028_test`；未清空开发库。隔离应用端口3397，前端构建 `.scratch/issue37-real-web`，编译输出 `.scratch/issue37-real-dist`。密钥独立生成，连接信息仅在被忽略的 `.scratch/issue37-real.env`。用户前端5173返回200、服务端3000匿名会话接口401，未停止或重启用户服务。

以下命令均在 `application` 执行，顺序运行以避免测试库被并发清空：

| 命令 | 实际结果 |
| --- | --- |
| `npm run typecheck` | 通过，前后端类型检查 |
| `node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/issue37-real-dist` | 最终通过；首次受并发 #43 测试未用变量影响失败，后续该文件更新后通过；未修改对方测试 |
| `node node_modules/vite/bin/vite.js build --outDir .scratch/issue37-real-web` | 通过，保留既有包体积提示 |
| `node --env-file=.scratch/issue37-real.env node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue37-real.config.ts` | 最终1条通过，真实Nest/HTTP/PostgreSQL/Chromium；未模拟业务接口。仅在丢响应场景转发真实请求并丢弃已提交响应 |
| `node --env-file=.scratch/issue37-real.env --test .scratch/issue37-real-dist/tests/organization-state.test.js` | 1条通过，既有T26在途状态HTTP/PostgreSQL回归 |
| `node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue37.config.ts` | 1条模拟接口回归通过，作为前端补充 |

真实浏览器覆盖平台首次强改门禁；直属开户默认与校验、24字符/72小时、真实剪贴板（Windows CRLF规范化后相等）、关闭清除；详情直达刷新、取消菜单离开及取消浏览器后退保持输入；停用/恢复与数据库余额；重置撤销旧会话；开户及重置丢响应后的切页返回、幂等和核实结束；平台、分销、终端管理员、业务员依次登录及切换，后三种角色直达平台路径返回自己的合法默认页，重置管理员强改后重新登录。

T26补充回归覆盖跨企业状态拒绝；已收款未划拨订单保持reserved和2.0000库存预留、停用期间划拨409、恢复后划拨成功；pending查询和冻结保持，停用期间平台核对释放；queued邮件暂停并释放额度、uncertain继续保持，恢复后手动重确认；余额与历史未清零，停用不级联、两级分销直属交易边界保持。

测试关闭trace、截图及结果留存。一次剪贴板断言失败由Windows换行导致，已改为布尔比较并规范化CRLF，避免失败输出凭据；早期测试导航时机及旧模拟测试等待条件已修正，最终上述目标均通过。测试源已从忽略目录移至 `tests/issue37-real.spec.ts` 并加入忽略例外，能够随实现交付。

## 边界

本票未验证生产部署、其他浏览器及压力并发；没有发起正式供应商或真实邮件投递。T26在途断言使用既有受控夹具，不代表正式供应商联调。未重跑全部其他票测试；本次订单入口保留兼容流程，独立订单页面后续验收归其所属工单。浏览器前进全组合、复制失败降级和真实72小时等待到期未单独执行；已验证生成有效期和成功复制。未知请求跨刷新恢复不属于本次功能。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动。
- 应用规则：ACTIVE MUST FCS-007、011、013、019、021–027、030；GUIDANCE FCS-014、032；未新增依赖，028/029无需变更。
- 校验：类型检查、隔离编译与构建、上述相关浏览器和HTTP目标均通过。未执行格式化/lint，package.json未定义相关脚本；未执行无关全量套件，避免覆盖范围外与共享测试环境。
- 冲突：无。存量规范债务：未对未触及区域整改。PENDING命名、排序等规则未提升为强制，不影响本次选择。
