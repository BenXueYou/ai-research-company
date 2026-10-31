# 验证入口修复（2026-10-31）

恢复清理提交 c30a146 删除的 `tests/policy.test.ts` 和采购浏览器测试依赖 `tests/procurement-helpers.ts`，并调整根 `.gitignore` 使两者可纳入版本管理。测试和辅助代码来自删除前的版本，未改变业务实现。

- `npm test`：通过，3 个身份策略测试通过。
- `npm run typecheck`：通过，包含前端和服务端类型检查。
- 采购浏览器测试未执行：其辅助代码使用 127.0.0.1:55436 上的专用 PostgreSQL 并创建随机数据库；类型检查通过不代表采购业务验收通过。
- 其他历史入口仍需单独处理：`test:members` 引用已删除的 `members.test.ts`；`test:integration` 还引用已删除的 `organizations.test.ts`，且其中 `umail.test.ts`、`company-search.test.ts` 在本机存在但未被 Git 跟踪；`test:t20` 依赖同样未跟踪的 `umail.test.ts`。未运行这些数据库测试，也未验证其覆盖及数据库隔离条件。
- 本次修复不代表票 03 业务验收完成；票 03 销售产品词浏览器可见性断言仍待处理。
