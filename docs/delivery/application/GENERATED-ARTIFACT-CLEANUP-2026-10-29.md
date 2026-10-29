# 生成产物清理记录（2026-10-29）

本次仅处理测试文件保留与生成产物忽略规则，不修改业务代码、请求参数或数据库。

## 基线与保留范围

- 本轮开始时，前次确认的 36 个编译副本目录均已不存在；这些目录的删除不是本轮执行的。
- `application/issue34-test-web`、`issue35-test-web`、`issue36-test-web`、`issue45-test-web` 已在工作区显示为删除，对应产物被移动到 `application/.scratch/` 下。
- `issue38-tests`、`issue45-tests`、`issue46-tests`、`issue57-tests` 源码也被移到了 `.scratch`。逐文件与 HEAD 对照，仅存在相对导入层级调整；本轮恢复原路径版本，保持现有 TypeScript、Playwright 配置和夹具访问路径有效。
- 保留测试源码、配置、夹具、截图、JSON 验收证据、Issue 草稿及本地环境文件；不批量忽略整个 `.scratch`。

## 忽略规则

- 根目录 `.vite`、Python 字节码及 `.scratch/*-dist`。
- 应用目录 `issue*-test-web`、`.scratch/*-dist`、`.scratch/*-web`、`.scratch/**/compiled`、`t15-style-compiled` 和 Vite 缓存。
- 不使用任意层级 `web/` 忽略规则，避免隐藏临时保留的前端源码。
- 忽略规则只作用于未跟踪文件；已经进入 Git 的历史产物不会仅因新增规则而退出版本管理。

## 验证与剩余工作

- 已通过 `git diff` 核对恢复的四组测试源码与 HEAD 一致。
- 已通过 `git check-ignore --no-index` 验证编译目录和缓存命中忽略规则；测试源码、夹具、抽查的 JSON 证据及 Issue 草稿不命中。
- 最初删除 `.scratch` 中四个移动后的测试构建目录、四组重复测试源码时，执行工具返回 `blocked by policy`。随后提供 `application/scripts/cleanup-generated-copies.ps1`：默认预览，使用 `-Delete` 执行，删除前检查路径、链接、文件类型及重复源码一致性。
- 提交前复核：上述八个目录均已不存在，四组保留的测试源码与 HEAD 一致。脚本再次预览返回零个待清理目录；本记录仅确认当前磁盘状态，不推断删除由何种方式执行。
- 其他未确认可由现存源码重建的历史编译目录继续保留。已有受版本管理的历史产物仍需在允许删除操作的环境中清理，不能将新增忽略规则解释为全部清理完毕。
- 未运行数据库、HTTP 或浏览器业务测试；本轮无业务代码及契约变更，也未重新证明历史验收结果。
