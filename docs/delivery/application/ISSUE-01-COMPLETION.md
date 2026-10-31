# 本地票01交付记录：版本化升级与数据保全入口

日期：2026-10-31。范围仅为 `.scratch/experience-optimization-20261031/issues/01-versioned-upgrade.md`，未修改业务页面、既有初始化流程或后续票据结构。

## 实现

- 新增 `server/migrations/upgrade.ts`，维护当前已知表清单、关键列门禁、结构指纹、全表行数/内容摘要、`schema_migrations` 与 `upgrade_snapshots`。
- 新增独立 `server/upgrade-cli.ts` 和 `npm run upgrade -- plan|apply|verify`。`migrate/bootstrap` 仍只用于全新库初始化。
- `apply` 使用独立 PostgreSQL advisory transaction lock（712011）和既有事务封装；首次纳管只登记当前 baseline，不创建后续业务表。重复执行只复核结构并返回幂等结果。
- 未知表、缺失关键表/列、未知版本或 baseline 结构校验和冲突时拒绝；事务失败不会留下迁移记录。可选 `--backup-dir` 调用 `pg_dump` 生成 custom-format 备份，备份失败不会开始升级。

## 验证

验证库为 Docker 独立、可丢弃的 `acquisition_upgrade_test`，未使用现有开发库；另用 `acquisition_upgrade_fail_test` 验证故障回滚。

| 命令/场景 | 结果 |
| --- | --- |
| `npm run db:migrate`（升级演练库） | 通过；仅建立当前新库结构，作为夹具准备，不作为旧库升级入口 |
| `npm run upgrade -- plan` | 通过；返回 `2026-10-31.current` 待建立及结构 checksum |
| `npm run upgrade -- apply` | 通过；写入 baseline 与快照，未新增业务表 |
| `npm run upgrade -- verify` | 通过；`ok=true`、`unchanged=true` |
| 再次 `npm run upgrade -- apply` | 通过；幂等，无重复 baseline |
| 临时加入未知表后 `plan` | 按预期拒绝，随后删除临时表 |
| `apply({failAfterBaseline:true})` | 按预期失败；事务回滚，`schema_migrations_after_failure=null` |
| 新增升级器严格 TypeScript 编译 | 通过：`npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUnusedLocals --noUnusedParameters --esModuleInterop --skipLibCheck server/migrations/upgrade.ts server/upgrade-cli.ts` |

`npm run typecheck` 和 `npm run build` 未通过，原因是工作区既存的 `tests/browser/procurement.spec.ts` 引用缺失的 `../procurement-helpers.js`；该文件不属于本票，本票未修改或绕过该问题。

## 边界与未验证项

- 本票当前没有业务增量迁移，因此没有提前创建档案来源、身份、批次、证据、job 等后续票结构；`upgrade verify` 的快照覆盖当前代码已知的全部业务表，包含档案、联系人、人工记录、附件、邮件、软删除和查询/账务表的行内容摘要。
- 本地演练使用当前初始化结构，未在真实旧业务库、生产环境、真实附件存储、真实供应商、真实付费接口或正式邮件系统执行。未执行备份恢复切换：当前环境未提供 `pg_dump` 可执行文件；代码仅提供可选备份生成并在文件为空时拒绝成功，不宣称已完成灾备恢复验收。
- 未新增或调整页面，因此没有前端路由、响应式布局或页面交互回归范围。
