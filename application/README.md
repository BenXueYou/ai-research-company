# T01 身份应用

本目录是 Vue 3 + TypeScript / NestJS / PostgreSQL 的最小真实身份闭环，不是原型账号模拟。规则以[身份决策](../docs/decisions/001-t01-identity.md)为准。实现与测试结果见[验收记录](./VERIFICATION.md)。未实现开户、管理员重置密码、供应商接入及后续业务模块。

## 环境与安装

验证环境：Windows 11、Node.js 22.14.0、npm 10.9.2、Docker Desktop、PostgreSQL 17.6。建议 Node.js 22 LTS。以下命令均在本目录执行；使用仓库根目录终端时先进入本目录。

```sh
npm ci
```

复制配置样例并填写自有 PostgreSQL 凭据、数据库及精确的浏览器访问源：

```sh
cp .env.example .env
```

Windows PowerShell 可用 `Copy-Item .env.example .env`。配置文件不会提交。连接串的用户名、密码须正确进行 URL 编码。应用不自动建库，也不在启动时自动初始化账号。

## 数据库与一次性部署引导

为应用建立专用数据库和数据库角色，不使用共享生产库做试验。先迁移，再在可信、无终端录制的交互式终端执行一次引导：

```sh
npm run db:migrate
npm run bootstrap -- --confirm-bootstrap
```

交互输入真实初始平台管理员邮箱和平台组织名称。命令生成随机 24 字符临时密码，仅在这次终端显示；妥善安全交付，不复制到工单、聊天、脚本或日志。临时密码 72 小时有效，首次登录必须修改。不得重定向此命令输出。非交互终端会拒绝引导。

数据库事务与跨进程锁保证平台组织、账号、引导标记、审计原子创建；重复或并发引导只能成功一次。没有公开初始化 HTTP 接口，也没有预置账号密码。临时凭据遗失或到期的恢复流程属于后续管理员重置工单，勿删表重新引导生产系统。

## 启动

推荐先验证生产构建的同源运行方式：

```sh
npm run build
npm start
```

默认打开 http://127.0.0.1:3000 。`APP_ORIGIN` 必须与浏览器源完全一致（协议、主机、端口），不能混用 localhost 与 127.0.0.1。应用只监听回环地址。

开发时两个终端分别执行：

```sh
npm run dev
npm run dev:web
```

此时浏览器使用 Vite 显示的端口，并把配置中的 `APP_ORIGIN` 改为该精确源后重启后端；Vite 代理 API 至后端 3000 端口。浏览器安全策略以生产同源构建为验收目标，开发热更新不是生产部署方式。

生产须设置 `NODE_ENV=production`、HTTPS 的 `APP_ORIGIN`，并由同机 HTTPS 反向代理转发到回环端口。生产 Cookie 带 Secure。日志/代理/APM 禁止记录 Cookie、Set-Cookie、密码请求体、CSRF 头及引导输出。为数据库配置 TLS、最小权限、备份及受控迁移权限；这些运维项不由本票自动配置。当前未启用信任任意代理头，因此限流在反代后按代理地址聚合；上线前应在可信入口补充限流，不能直接信任客户端 X-Forwarded-For。

## 功能与安全边界

- 邮箱只将域名转小写，本地部分区分大小写，不合并加号别名或圆点。
- 新密码按 Unicode 码点计数 12～128，允许空格，不裁剪、不归一化、不要求字符组合，不得与当前密码相同。
- 随机盐 scrypt 摘要；随机不透明会话令牌，数据库仅存 SHA-256；CSRF 令牌独立生成并存摘要。
- 会话最长 8 小时，空闲 30 分钟失效。退出撤销当前会话；首次/主动改密撤销所有设备，必须重新登录。
- 全局守卫默认保护 API，只有登录公开；临时及重置态禁止工作台请求，不能通过直接请求绕过 UI。
- 改密仅从会话确定本人，不使用客户端目标账号字段；所有角色共用入口。重置状态的测试由数据库夹具模拟，没有本票之外的重置接口。
- 审计只保存固定事件、账号 ID、时间，不保存请求体、密码、摘要或令牌。登录错误统一提示；数据库持久化每来源 15 分钟最多 40 次 KDF 预算。
- 后续业务控制器必须保留默认守卫；当前最小工作台不代表后续多租户业务授权已实现。

## 真实 PostgreSQL 测试

**集成和浏览器测试会清空指定测试库的全部身份表。只能使用独立、可丢弃的库；库名必须以 `_test` 结尾。不要并行运行两个测试套件或与手工验收共用库。**

可使用提供的 Docker Compose 测试数据库。创建本地 `.env.test`，自行填写以下两个变量，不要提交或展示真实值：

```dotenv
POSTGRES_PASSWORD=<自行生成的高熵测试数据库密码>
TEST_DATABASE_URL=postgresql://acquisition:<上面密码的URL编码值>@127.0.0.1:55432/acquisition_test
```

```sh
docker compose --env-file .env.test up -d --wait
npx playwright install chromium
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
```

测试使用真实 Nest HTTP 服务、真实 PostgreSQL 和 Chromium，不替换后端请求。集成服务端口 3091、浏览器端口 3092，请确保空闲。浏览器测试关闭 trace 和截图，避免将凭据写入工件。测试脚本自动读取本地 `.env.test` 并编译后运行。构建产物、测试日志、浏览器报告、依赖与环境秘密均被忽略。

关闭测试数据库（保留数据卷）：

```sh
docker compose --env-file .env.test down
```

仅在确认是可丢弃的测试数据时才另行删除数据卷。测试结束后库内是测试夹具而不是可交付初始账号，实际部署应使用另一空库执行部署引导。
