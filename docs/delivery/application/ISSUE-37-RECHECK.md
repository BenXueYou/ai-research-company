> 历史阶段记录。2026-10-28 已补齐功能并通过本票本地真实业务验收，最终范围和边界见 [ISSUE-37-COMPLETION.md](ISSUE-37-COMPLETION.md)。

# Issue 37 本次核对记录（2026-10-28）

基线 HEAD `04b85d8`。本次开始前工作区已有未提交的 `PlatformOrganizationsPage.vue` 和共享路由、App 修改；其归属未确认，本次未修改这些文件。#44 与其他并发工作也予以保留。

| 操作 | 原组件来源 | 请求及服务端边界 |
| --- | --- | --- |
| 直属列表 | `GET organizations` 返回 parentName、allowedKinds、children | 服务端按会话确定上级；列表项目包含组织 `id`、开户管理员 `accountId`、`email`，不能相互替换。 |
| 开户 | 表单 `name`、`kind`（默认 terminal）、`countryCode`（默认 +86）、`phone`、`email`、页面内 `requestId` | POST `organizations` 原样传字段；上级从会话决定；名称非空、电话非空无空白、区号匹配原正则，浏览器表单负责邮箱必填。失败保留 requestId；凭据关闭后清空名称、电话、邮箱并生成新 requestId。 |
| 重置 | 选择的直属项目 `accountId` | POST `password-resets`，`accountId` 来自该项目，`requestId` 每次点击新生成；成功凭据只在当前内存展示，关闭后不查询明文。 |
| 停用/恢复 | 选择的直属项目 `id`、`active` | POST `organizations/state`，`organizationId = child.id`、`active = !child.active`；刷新列表。 |

现有未提交页面的静态检查发现：同一路由查询参数切换时 `onBeforeRouteUpdate` 会清空表单并生成新开户 requestId；如果请求响应丢失后离开再返回，无法据此证明复用原请求标识。重置失败后再次点击生成新标识，不能宣称结果不确定时防重复。`CompatWorkspace.vue` 仍对平台挂载原 `OrganizationOpening`；当兼容工作区已被访问后，即使隐藏仍可能与新页面并存并发出列表请求。详情缺少定价及订单入口。以上是源码观察，不是运行验证。

本次没有修改应用代码或运行构建、浏览器、HTTP、数据库测试。尚需用组织 ID、管理员账号 ID 和邮箱各不相同的真实夹具验证开户、凭据复制、关闭、重置及旧会话失效、状态变更、跨级拒绝、余额和在途状态、丢失响应与落库次数、页面直达刷新与离开交互。正式供应商及生产环境未验证。为避免覆盖其他工作，需先确认已有 #37 页面是否可在保留现有内容的前提下继续修改。
