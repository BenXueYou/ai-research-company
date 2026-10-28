# Issue #57 团队发信设置页面交付

2026-10-28。范围：[GitHub #57](https://github.com/BenXueYou/ai-research-company/issues/57) 正文及兼容容器退出补充验收，已通过实时 GitHub API 读取正文和评论端点。依据控制台迁移 Spec、第一阶段 Spec、T19/T20 业务实现及已有交付复核；远端 Open 不作为未实现依据。

## 基线与修改

基准提交 `2bf193c186d40c939494d317d40eafb459d9dd0e`，共享工作区已有大量未提交成果。保留 #48/#50/#51 分销接入及 #52/#53/#54/#56/#58/#59 等成果，不计入本票；#49/#55 并行文件未覆盖。页面已有未提交样式完整保留。

- `/terminal/sending-settings` 真实渲染 `TeamSendingSettingsPage`；保留 admin/sales 角色门禁和 role/request 绑定。原 `TeamSmtpSettings.vue`、`TeamUMailSettings.vue` 归位到 `web/pages/email/components/`，只有本模块调用；新增同目录 `useChannelForm.ts`。
- 路由删除 `compat-sending` target，兼容容器移除两类设置旧挂载及导入，App 排除本兼容路径并将本页加入现有有限 KeepAlive 名单。没有滚动定位或跨组件事件依赖，没有重复设置实例。
- Nest/Vite 白名单原已包含该路由，实际验证直达刷新，未改服务端、供应商、数据库结构、业务接口或公共离开机制。
- 新增本票真实专项、独立配置及验证 runner；原模拟夹具补公共离开 provider，继续验证原参数映射。只增加本票测试的 gitignore 例外及独立产物忽略项。

## 契约对照与证据

迁移前来源核对原 SMTP/U-Mail 组件、服务端 schema/service；迁移后真实 HTTP 请求、标识对照及受控适配器实值见 [ISSUE-57-EVIDENCE.json](ISSUE-57-EVIDENCE.json)。凭据仅为运行期测试夹具，证据已脱敏。

| 链路 | 迁移前 → 迁移后相同来源及实例值 | 服务端及外部边界 |
| --- | --- | --- |
| 两类 GET | 无请求体，不传组织/渠道/资源 ID | 仅服务端会话确定企业；不回显凭据或外部资源标识 |
| SMTP 网络 | 表单 `host=smtp.issue57.test`、字符串 `port=587`、选择值 `security=starttls` | 原规则将端口转换为数字 587，适配器收到原地址/端口/安全枚举 |
| SMTP 身份 | `username=authentication-57`、本次输入的 credential、`replyTo=smtp-reply@issue57.test` | 与登录邮箱 `admin-a@issue57.test` 区分；适配器收到各原值。按原 AES-GCM 企业/渠道关联数据加密；updated_by 为账号 ID，organization_id 为企业 ID |
| U-Mail | 各输入独立提供 `domain=mail.issue57.test`、`senderAddress=sender@mail.issue57.test`、`replyAddress=umail-replies@issue57.test` | 原校验要求发信地址属于域名；适配器 domain/senderAddress 保持原值；organizationId 取会话，resourceId 仅取本企业资源表中的 `external-resource-57-A` |
| 默认及请求 | 两渠道 defaultChannel 来自各自复选框，默认 false；requestId 由组件生命周期生成 UUID | 沿用本企业唯一默认渠道和现有幂等；SQL 验证切 U-Mail 默认后 SMTP=false、UMAIL=true |

夹具的组织 A/B、平台/分销组织、管理员/业务员账号、渠道 ID 和供应商资源标识均不同。HTTP 只含原字段集合，不传组织或资源 ID；伪造组织/资源字段返回 400，跨角色维护返回 403。原 SMTP 端口/凭据校验、服务端字段校验、权限、枚举、默认、域名和配额规则保持，不混入业务修正。

## 生命周期

- 按 session generation 缓存本页面。首次挂载每渠道 GET 一次，切页和返回不新增配置或供应商核验。退出和换账号销毁页面并清空本地凭据和请求快照。
- dirty：菜单/后退可以取消继续编辑或确认放弃；放弃恢复原配置、清空凭据。公共 beforeunload 保护刷新/关闭。缓存只在当前页面会话内有效，不提供跨刷新恢复。
- submitting：输入和普通提交禁用，公共守卫阻止离开，无重复 POST。
- unknown：网络失败、服务端 5xx 或无效保存响应保留原载荷、requestId 和上下文，冻结编辑和普通提交。确认可离开，返回不自动 GET/POST 或核验。用户主动点「使用原请求核实」才使用原载荷和标识调用原接口；若已保存，服务端幂等返回而不再核验供应商；若未保存，将继续保存，页面说明此行为。
- 明确客户端拒绝允许继续编辑；成功清空 SMTP 凭据并按原行为生成下一 requestId。上下文不写 localStorage/sessionStorage。页面无业务 query 参数，不增加参数 watcher；公共 fullPath 离开保护继续生效。

## 实际命令及验证

环境：Windows、Node.js 24.15.0、Chromium、真实 Nest HTTP、Docker PostgreSQL 17.6。独有随机命名 PostgreSQL 容器、动态回环端口，浏览器另建随机 `_test` 数据库，HTTP/Vite 动态端口；独立编译/构建/测试目录 `.scratch/issue57/`，不写共享 dist/test-results。结束仅关闭本次服务、删除本次库及容器，无用户服务重启或共用库清空。

命令均在 application 下执行：

| 命令 | 结果及范围 |
| --- | --- |
| `npm run typecheck` | 最终通过。中途曾遇 #49/#55 并行测试文件未写完或未使用变量，未修改其文件，随后复检通过 |
| `node scripts/verify-issue57.mjs` | 独立服务端编译及 Vite 构建通过；原 SMTP 服务专项 6/6、U-Mail 专项 6/6 通过。浏览器早期夹具错误和一次 Windows worker 异常退出不计通过，修正后单独重跑 |
| `node scripts/verify-issue57.mjs --browser-only` | 真实浏览器专项通过，含独立编译与 Vite 生产构建；最终脱敏证据由成功运行生成。补充原生刷新/关闭检查的取消导航等待方式也在本专项中验证 |
| `node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue57.config.ts` | 原模拟映射专项 1/1 通过，仅作为字段映射补充 |

实际真实场景：管理员两渠道配置/状态/DNS、不同认证/登录/发信/回复地址、凭据加密及成功清空、唯一默认；dirty 取消和放弃、提交中禁写/阻止导航、前进后退、刷新/关闭保护；两渠道已落库丢响应，unknown 取消/确认离开、返回不重放、原 requestId/原载荷主动核实；业务员只读和直接写拒绝，平台/分销页面和 GET/POST 拒绝；企业 B 空配置、未配资源拒绝、伪造组织/资源字段拒绝、发信地址错域拒绝；强制改密门禁、退出换账号、旧 GET 迟到隔离；Nest/Vite 深链直达刷新、缺失静态资源和未知 API 404。

浏览器受控调用：SMTP verify=2，U-Mail inspectChannel=2，各为正常保存一次和已落库丢响应一次；切页返回及原请求幂等核实没有增加供应商调用，实际投递=0。`internal_point_accounts`、`query_point_ledger`、`email_daily_usage`、`email_batches`、`email_recipients` 前后完整快照一致：A 企业余额 157、查询冻结 2、销售预留 3，邮件预占 2/使用 7 均不变；浏览器 pageerror 为 0。

## 未验证范围与遗留

- 未做正式 SMTP 连接认证、生产 DNS、真实 U-Mail 隔离/投递/退信/回复实收、生产 HTTPS/反向代理、部署或跨刷新恢复。强制改密本票验证门禁，未重跑完整改密成功及旧 Cookie 失效。未重跑 #55 联系人及预览发送、#56 发送记录、跨日实际执行等未改业务。
- 原服务专项涵盖校验、不可用/待验证、权限、幂等冲突、凭据加密与密钥指纹；不将其通过扩展为所有供应商异常或所有发信分支已验证。
- 既存展示疑点单独记录：某渠道改为默认后，另一卡片的旧内存状态未主动同步刷新；数据库唯一默认已核验。本票不借迁移改变默认规则或增加激活自动刷新。
- 当前兼容容器只余 CoefficientNotice，其他任务仍在并行，最终全角色退出证据未汇齐。按本批要求保留 CompatWorkspace、App 兼容状态和 EmptyRoute 通用逻辑，留待全部任务结束统一审计；不宣称全局退出完成。
- 未提交、推送、关闭远端票据、部署或重启用户服务。Vite 构建有既有大 chunk 提示，正常成功退出，未扩大拆包范围。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动。另应用 Vue skill 的 Composition API/script setup 指引。
- 应用规则：ACTIVE MUST FCS-007/011/013/019/021～027/030；GUIDANCE FCS-014/032。无依赖变更，FCS-028/029 无新增适用内容。
- 校验结果：typecheck、独立编译/构建、原服务专项、模拟专项及真实专项通过。未执行：项目无独立 lint/格式化脚本；未临时安装工具或改配置；无关全量和部署测试不在本票范围；默认 build 写共享 dist，改用独立输出的等效编译/构建。
- 冲突：无。存量规范债务：未触及文件未统一格式化。
- PENDING：命名、块顺序、缩进、属性排序等尚未启用，沿原约定，无本票必须澄清项。
