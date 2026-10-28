# 重复验收脚本清理（2026-10-28）

本次仅删除已确认重复的历史验收脚本及其专用配置。开始时工作区已有应用、测试、配置和交付文档的未提交改动，本次不修改这些文件，也不修改业务代码、npm 命令或数据库。

| 删除项（相对 application/） | 保留的覆盖与判断依据 |
| --- | --- |
| `tests/browser/issue35-navigation.spec.ts` | `tests/browser/router-navigation.spec.ts` 包含完整原场景，并增加深链与不存在路径检查及两个会话场景。差异仅涉及额外检查、Express 导入、服务端口和静态构建目录。 |
| `config/playwright/playwright.issue35.config.ts` | 仅匹配上述旧导航脚本；当前导航专项入口为 `config/playwright/playwright.router.config.ts`。`playwright.issue35-completion.config.ts` 及对应离开保护测试仍保留。 |
| `issue45-tests/upstream.test.ts` | `tests/issue45-upstream.test.ts` 去除首尾空行并对齐 helpers 导入路径后内容完全一致。专项浏览器脚本及其编译配置仍保留。 |

历史 `ISSUE-35-COMPLETION.md` 和 `ISSUE-45-COMPLETION.md` 中的旧命令是当时执行的证据，原文保留；其中指向上述删除项的命令已停用。当前重跑入口（在 `application/` 执行，需自行准备独立可丢弃的 `_test` 数据库及 `.env.test`）：

```sh
# 导航：按保留配置编译到其预期目录，前端使用当前 dist/web
node node_modules/typescript/bin/tsc -p tsconfig.server.json --outDir .scratch/router-dist
node node_modules/vite/bin/vite.js build
node --env-file-if-exists=.env.test node_modules/@playwright/test/cli.js test --config config/playwright/playwright.router.config.ts

# 上游监控集成：使用 tests/ 下的唯一副本
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node --env-file-if-exists=.env.test --test dist/tests/issue45-upstream.test.js
```

验证：删除前以 Node 断言核对上述两组源码，归一化后的上游测试完全相同；导航测试在排除端口、构建路径、额外导入和新增的两条断言后，以完整旧脚本为前缀，全部旧业务断言保留。删除文件的活动配置引用已同步移除。

删除后 `node node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit` 通过；`npm test` 的 3 项策略测试通过；活动源码中未发现指向删除项的残留引用，删除项的 `git diff --check` 通过。

本次未运行真实 HTTP、数据库或浏览器业务流程，也未连接供应商；源码比较证明重复覆盖关系，编译及策略测试不代表业务回归已通过。其他专项验收即使名称带有历史 Issue，也未据此删除。进行中的 platform-integration 测试尚未提交，不将其作为删除已有测试的依据。
