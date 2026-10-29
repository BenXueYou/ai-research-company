# 本地腾道配置与 Redis 使用教程

配置日期：2026-10-29。

## 配置位置

- 应用实际读取：`C:\PXY\ai-research-company\application\.env`。
- 腾道配置副本：`application/.env.tengdao`；不会自动加载，后续修改以 `.env` 为准。
- 两个文件均被 Git 忽略。API 密钥取自 `docs/接入凭据备忘录.md`，不在本文回显。

```dotenv
TENGDAO_BASE_URL=https://open-api.tendata.cn
TENGDAO_BUSINESS_DAILY_LIMIT=100
REDIS_URL=redis://127.0.0.1:56379
```

API 基础地址来自[腾道官方对接指南第 3 节](https://open-api.tendata.cn/integration-guide.html)。现有适配器自行添加 `/v2/...` 路径，基础地址不加 `/v2`。业务类日限额按用户要求暂设为 100，不代表供应商合同配额；该配置限制业务类调用，不是所有数据查询的总次数。

## Redis 是什么、地址从哪里来

Redis 是后端缓存腾道令牌和共享调用计数的本地服务，无需向腾道申请地址。当前运行在本机 Docker 中，仓库 `application/compose.yaml` 将本机 `127.0.0.1:56379` 映射到容器的 `6379`，所以本机运行的后端使用 `redis://127.0.0.1:56379`。该地址仅适用于当前本机环境。

## 启动、检查与停止

先启动 Docker Desktop，再在 PowerShell 执行：

```powershell
Set-Location C:\PXY\ai-research-company\application
docker compose --env-file .env up -d --no-deps --wait redis
docker compose --env-file .env exec -T redis redis-cli ping
```

看到 `PONG` 表示服务可用。命令只启动 Redis，不启动或初始化测试数据库。首次运行若没有镜像，Docker 会下载镜像。Redis 数据保存在 Compose 的 `tengdao-redis` 数据卷中。

修改 `.env` 后重启后端加载配置；本地开发启动命令：

```powershell
npm run dev
```

若后端已经运行，先在原终端按 Ctrl+C 停止，再执行启动命令。`npm start` 也读取 `.env`，但依赖已存在的构建产物。Vite 前端无需读取腾道密钥。

查看状态或停止 Redis：

```powershell
docker compose --env-file .env ps redis
docker compose --env-file .env stop redis
```

停止 Redis 后，依赖它的腾道查询无法正常使用；需要使用时重新执行启动命令。

## 本次验证

已启动 `application-redis-1` 并通过健康检查；容器 `redis-cli ping` 及应用 Redis 客户端连接均返回 `PONG`。已核对 `.env` 可加载、密钥与备忘录一致、业务类日限额为 100，其余既有配置保持原值。

本次未重启现有后端，未调用腾道令牌、账户或查询接口；账号权限、真实配额和付费业务流程尚未验证。
