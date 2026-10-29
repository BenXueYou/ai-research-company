# 测试目录集中整理（2026-10-29）

基线：开始时 `git status --short` 为空。本轮仅整理验证源码、配置、运行产物和文档，没有修改 web/server 业务实现、请求值来源、标识映射、默认值、权限或提交条件。

## 用途与归类

| 原 application 下位置 | 用途 | 新位置（相对 application） |
| --- | --- | --- |
| integration-distribution | 两级分销跨页面、订单、权限和账务集成验证 | tests/integration-distribution |
| integration-terminal | 终端查询、档案、邮件、设置、用量与会话集成验证 | tests/integration-terminal |
| issue38-tests | 下级账户专项验证 | tests/issue38-tests |
| issue45-tests | 上游监控、路由和权限专项验证 | tests/issue45-tests |
| issue46-tests | 人工对账、离开保护、幂等、权限和账务验证 | tests/issue46-tests |
| issue57-tests | 团队发信设置页面及受控夹具 | tests/issue57-tests |
| reconciliation-route-tests | 对账路由、表单保留和参数来源验证 | tests/reconciliation-route-tests |
| verification | 采购、费用及权限专项验证 | tests/verification |
| dist-t06 | T06 历史编译产物 | .scratch/t06/compiled |
| .t06-runtime | T06 浏览器运行静态文件与截图 | .scratch/t06/runtime |
| test-results | 旧 Playwright 运行状态 | .scratch/playwright-results/legacy |

`tests` 已是统一测试源码入口，`scripts` 保留部署、维护与验证执行器，`config` 保留公共工程配置。业务源码仍在 web/server；dist 是常规启动入口依赖的构建结果，node_modules 是第三方依赖，均保留工具链默认位置。.scratch 内还有历史源码、夹具和证据，不整体忽略或删除。

同步更新了专项相对导入、TS 编译根、编译后测试发现目录、Issue57 夹具 URL、分销/终端 runner、T06 运行目录以及历史样式验证准备脚本。主 tsconfig 显式排除迁入的专项，专项配置显式保留各自原有编译范围，避免移动后被默认构建自动包含。根忽略规则对八组测试目录增加例外，确保源码可以交付；本次没有删除测试或历史证据。旧交付记录保留原始运行路径，当前命令以 application/README.md 为准。

## 契约与验证

- 对照 HEAD 核验 11 个迁移后的测试/夹具源文件：除相对导入和夹具 URL 外一致；对账路由测试内容完全一致。测试中的请求字段、值、断言和拒绝路径均未更改。
- `npm run typecheck`：通过。
- `tsc -p` 分别运行 `tests/integration-distribution/tsconfig.json`、`tests/integration-terminal/tsconfig.json`、`tests/issue38-tests/tsconfig.json`、`tests/issue45-tests/tsconfig.json`、`tests/issue45-tests/tsconfig.router.json`、`config/tsconfig.issue41.json`：六组编译通过。编译覆盖到了历史被 Git 跟踪的 issue45 生成文件，本次已将这些验证副产物恢复为 HEAD 内容，避免混入交付。
- Playwright `--list --config` 验证分销、终端、Issue41、Issue45、router-upstream、Issue46 六组入口：通过，分别发现 1、2、1、1、1、1 个场景。测试发现仅证明配置和导入可加载，不代表业务场景通过。
- `node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.issue57.config.ts`：1 passed。迁移后的 Vite 夹具可访问，覆盖管理员提交映射与业务员只读。SMTP/U-Mail 的值来源与原断言保持一致，受控请求校验实际通过。
- `node node_modules/vite/bin/vite.js build`：通过，保留既有大包体积提示。
- `node node_modules/@playwright/test/cli.js test --config config/playwright/playwright.reconciliation-route.config.ts`：失败。初次执行及重建前端后重跑，均在第 75 行返回后查找“供应商账单引用”失败。未放宽断言，未修改业务逻辑，不能宣称对账流程验收通过。
- `git diff --check`：通过。

未执行：真实 PostgreSQL/HTTP 的分销、终端、下级账户、上游、人工对账、采购及 T06 全流程；没有重跑默认 npm test 或完整 npm run build（本轮分别执行类型检查、专项编译和 Vite 构建）。未进行数据库初始化、部署、供应商调用或外部发信。当前不能用编译与测试发现替代这些业务验收。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1。
- 触发：自动，Issue57 Vue 测试夹具相对导入需要随目录调整。
- 应用规则：ACTIVE MUST FCS-007、FCS-030，直接触及的 import 无新增空白行或未使用声明；其他区域保留原样。
- 校验结果：typecheck、六组专项编译、Vite 构建、Issue57 浏览器测试通过；对账路由浏览器测试失败，详情见上文。项目未提供格式化或 lint 脚本，未执行；其余业务套件未执行，避免将目录验证扩大为数据库验收。
- 冲突：无。
- 存量规范债务：不在本轮进行跨文件格式调整。
- PENDING：无需要本轮澄清的规则，不启用待确认规则。
