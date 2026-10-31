# 票03实施与验证记录

最新进展（2026-10-31）：本轮已补齐管理员公司名关联、销售产品词关联、三个宽度实际页面及联系人/沟通历史保全。产品词名称零行高问题已修复。本地显式关联范围验证通过，E04自动识别仍关闭。下文保留历史执行记录；最新事实见[SOURCE-IDENTITY-2026-10-31](SOURCE-IDENTITY-2026-10-31.md)。

日期：2026-10-31。代码已实施，完整业务页面验收尚未完成，票据不能视为已验收。

## 实施

- 公司名及产品词名单支持同名候选选择：关联已展示的本企业档案，或明确作为另一家入库。跨来源自动识别保持关闭（E04 尚无稳定标识证据）。
- 保留来源快照和选择决定；同来源重试返回现有档案；拒绝软删除、跨租户或未展示目标。普通入库和确认入口分别绑定请求幂等语义。
- 组织锁保护并发判断；每项及其结果独立事务提交，中断后同请求继续未完成项；约束冲突返回单项失败。
- 保留既有 profileId 和人工资料，不搬迁或合并历史。票04仍需在本票共享文件稳定后串行整合，见 ISSUE-04-INTEGRATION-BLOCKER.md。

## 已执行验证

使用独立 PostgreSQL 容器及数据库。`node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.server.json --test --test-concurrency=1 server/issue02-profile-import.test.ts server/issue03-profile-association.test.ts`：3 项通过。包括真实 HTTP 登录、CSRF 拒绝、同名候选及确认关联和重试；数据库专项覆盖同来源及同名并发、另建、跨租户、软删除、约束冲突、异常中断后继续、人工字段保全。夹具让本地候选 UUID、供应商列表 ID、详情 data.id 和档案 UUID 不同，保存请求的 sourceRecordId 来自本地候选 UUID；确认请求 profileId 来自候选档案。HTTP 关联前后上游调用次数、账本行数、余额及冻结余额不变。

`node node_modules/vue-tsc/bin/vue-tsc.js --noEmit` 通过；`node node_modules/vite/bin/vite.js build --outDir .scratch/issue03/dist/web` 通过，提示大包警告。`npm test` 失败：现有脚本引用缺失的 `tests/policy.test.ts`。`node node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit` 失败：现有 `tests/browser/procurement.spec.ts` 引用缺失的 `../procurement-helpers.js`。

规范及规格两轴审查发现的问题已针对候选确认、请求入口幂等、重复显示、处理期间锁定及换行修正；修正后运行上述专项验证。Vue 前端规范版本 0.0.1 自动触发，遵循显式组件引入和既有目录职责。

## 尚未验证

未对两个实际业务页面进行宽屏、中间宽度、手机宽度的浏览器验收，也未完成选择到提交的完整浏览器端到端测试；未单独验证联系人和沟通历史的保全、产品词确认入口的真实 HTTP 流程、销售角色的完整链路。上述数据库与 HTTP 验证不能代替这些验收。跨来源稳定键并发归属及证据冲突不适用当前关闭的自动识别能力，待 E04 证据支持后另行实施。未提交，避免把未完成验收的工作标为完成。

## 2026-10-31 补充验收（未完成）

在独立 PostgreSQL 17.6 容器、真实 Nest HTTP 与 Chromium 中执行，供应商名单和产品词返回为受控数据；未修改或使用现有业务库。管理员通过公司名页面搜索、保存、在同名提示中选择现有本企业档案并确认，页面提供该档案链接。捕获的两次请求均使用数据库中的本地公司候选 UUID 作为 sourceRecordId，确认请求的 profileId 为已展示的原档案 UUID；供应商列表 ID 为 `vendor-list-111`，已有详情 data.id 为 `detail-data-222`，二者均不同于本地 UUID。关联前后余额、查询冻结和查询流水数量不变，名单上游调用保持一次。

公司名页面在 1440、900、390 像素下程序检测的文档宽度均不超过视口；截图显示主容器采用独立滚动，未完整覆盖候选选择区域，故不能据此认定三种宽度下完整页面布局已通过。销售账号登录后，受控产品词查询已成功结算并返回候选，随后浏览器 `toBeVisible` 断言报告候选隐藏；可访问性快照显示该候选，原因尚未确认，不能判定为产品缺陷或通过。尚未进入销售的产品词保存与确认请求，也未执行联系人和沟通历史保全的最终断言。

执行入口为一次性 `.scratch/issue03/acceptance.ts`，前端以 `node node_modules/vite/bin/vite.js build --outDir .scratch/issue03/web` 构建成功（既有大包警告）。浏览器验证共三次：第一次未切换公司名标签；第二次 Element Plus 下拉输入被占位元素覆盖，脚本应点击组件容器；第三次公司名链路通过后停于上述产品词可见性断言。依据工程脚手架同一命令最多修正重跑三次的约定，本轮停止重跑。测试容器已删除；票03仍未完成验收，不更改票据状态。
