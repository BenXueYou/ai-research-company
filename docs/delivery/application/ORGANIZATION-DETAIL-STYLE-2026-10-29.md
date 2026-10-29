# 直属下级详情样式优化（2026-10-29）

基线：工作区已有 package-lock.json 修改及未跟踪 application/.scratch/runtime，本次未修改这些内容。范围为平台和分销的直属详情模板，以及模块内共用 organization-profile.css。

参照 `原型设计/prototype-smart-acquisition.html` 的 #4356e0 主色、白色圆角卡片、详情图标、信息层级和浅灰底色。原详情连续段落改为组织概况、联系信息和管理操作；状态使用文本及色点，状态说明独立浅色提示，手机宽度下信息和按钮纵向排列。原型 V2 中的直属操作范围继续保留。

## 契约核对

| 链路 | 修改前后值与来源 |
| --- | --- |
| 详情选择 | query.id 匹配 children.id，未改脚本 |
| 停用/恢复 | organizationId = selectedChild.id；active = !selectedChild.active |
| 重置管理员密码 | accountId = selectedChild.accountId；requestId 仍由原函数生成 |
| 展示 | phoneMasked、email、kind、distributorLevel、active 均来自原 selectedChild |
| 禁用 | 平台 busy / credentials / resetUnknown；分销额外 stateUnknown 条件原样保留 |
| 交易入口 | 平台 /platform/ledger，分销 /distribution/orders，未增加选择或请求参数 |

## 实际验证

- `npm run typecheck`、前端 `vite build`、`git diff --check` 通过；构建有既有大包体积提示。
- 使用本机 Chrome + Playwright，1440×1000 与 390×844 两种宽度，检查平台及分销详情，手机无横向溢出；人工检查平台桌面及手机截图。
- 验证脚本：`application/.scratch/organization-profile/verify.mjs`；截图同目录。
- 接口夹具区分组织 ID `organization-distinct` 和账号 ID `administrator-distinct`；两角色停用、恢复后状态更新正确，最终请求保持上述映射。
- 两角色重置凭据可见、凭据存在时禁止再次重置、关闭后密码消失；缺失组织显示原提示且无操作按钮；订单入口路由正确。
- 原 issue37 回归首次受缺少 Playwright 默认浏览器影响，切换 Chrome 后发现旧 session 夹具缺 loginName，导致 ConsoleHeader 渲染失败。未将其计为通过；本次独立验证夹具补齐 loginName 后详情流程通过。

边界：本次为接口夹具浏览器验证，未执行真实数据库、服务端越权拒绝及供应商流程；订单目标页仅验证路由到达，夹具未提供其账务数据，目标页 balance 读取错误不属于本次详情验证。业务脚本和后端未变。构建和类型检查不能代替这些未执行的场景。
