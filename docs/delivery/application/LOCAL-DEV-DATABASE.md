# 本地开发数据库配置与启动验证

日期：2026-10-28。用户明确授权创建全新本地开发数据库。

## 修改与环境

- 修正 `application/package.json` 的开发命令：`tsx watch --tsconfig tsconfig.server.json server/main.ts`，解决 `watch` 被解析为入口文件的问题。
- 新增 `application/compose.dev.yaml`：PostgreSQL 17.6、开发库 `acquisition_dev`、端口 `127.0.0.1:55433`、容器 `ai-research-dev-postgres-1`、新数据卷 `ai-research-dev_dev-postgres-data`。
- 本地 `.env` 已配置随机数据库密码和两个独立加密密钥，确认被 Git 忽略。未配置腾道服务，对应四个配置项为空。
- 原有 `application_identity-pg` 等卷与其他项目容器保留。原测试 Compose 配置保持原样。
- `APP_ORIGIN` 为 `http://127.0.0.1:3000`，通过后端提供已有 `dist/web` 构建；本次未重新构建前端。

## 实际验证

| 场景 | 结果 |
| --- | --- |
| `docker compose -f compose.dev.yaml --env-file .env up -d --wait` | 成功，容器健康 |
| `npm run db:migrate` | 成功，仅对本次新建开发库执行初始化 |
| `npm run dev` | 输出“身份应用已启动”，未再出现 `application/watch` 模块缺失 |
| 数据库状态 | 数据库名正确；1条初始化标记；1个需改密的初始管理员；2项加密密钥绑定 |
| `GET /` | 200，返回 HTML |
| 未登录访问会话 | 401 |
| 初始管理员按身份决策登录 | 200；请求仍使用 `email` 字段提交登录名；返回会话 `loginName=super_admin`、`mustChange=true` |
| 首次改密前访问工作台 | 403，符合现有规则 |
| 诊断登录会话退出 | 200，未修改管理员密码 |
| `git diff --check` | 通过 |

验证使用真实 HTTP 服务与真实 PostgreSQL。未执行首次改密、业务开户、查询、发信及完整集成或浏览器测试；上述验证不代表这些流程已验收。凭据不写入本记录，初始账号规则见 `docs/decisions/001-t01-identity.md`。
