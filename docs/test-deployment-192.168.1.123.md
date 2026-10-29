# 测试环境部署方案：192.168.1.123

编制日期：2026-10-29。基于当前工作区的 `application/README.md`、配置样例、部署脚本与服务启动代码核对。本方案尚未在目标服务器执行，不代表环境已验收。

## 1. 目标与部署方式

- 服务器：`192.168.1.123`；SSH 管理账号：`root`。SSH 密码不写入本文或脚本。
- 根目录：`/opt/ai-research-company`，不覆盖 `/opt` 下其他应用。
- 内网需求验收入口：`http://192.168.1.123:8080`，Nginx 8080 转发至应用 `127.0.0.1:3000`。服务器 80 端口已被占用，保留现有服务；部署前确认 8080 空闲。
- 应用使用 Node.js 22（仓库现有验证基线）、systemd 常驻；PostgreSQL 使用独立容器与持久化目录。Redis 在启用腾道时部署。
- HTTP 验收配置使用 `NODE_ENV=development`，但运行构建产物，不运行 watch/Vite。该选择匹配当前 Cookie 与 HTTPS 校验规则，仅用于受控内网测试。
- 若测试要求生产环境行为，改用受浏览器信任的 HTTPS 证书（IP 证书需含该 IP 的 SAN），设置 `NODE_ENV=production` 与 `APP_ORIGIN=https://192.168.1.123`，验证 Secure Cookie；也可配置内网域名及匹配证书。

流向：测试浏览器 → Nginx → Nest（前端静态资源与 API）→ PostgreSQL / 可选 Redis、供应商服务。附件仅通过应用鉴权接口访问。

## 2. 执行前核查

首次连接后只读核查 Linux 发行版、CPU/内存/磁盘、已有服务、8080/443/3000/55434/56380 端口、Docker Compose、Node/npm、Nginx、systemd、出网与磁盘权限。80 端口已有服务，不停止或覆盖；8080 须确认未占用。安装命令按实际系统选择，不预设 Ubuntu 或 CentOS。资源规划可先按 2 核、4GB 内存、20GB 可用磁盘安排，附件、数据库与备份空间另计，实际以负载验证为准。

如 `/opt/ai-research-company` 或目标数据库已存在，先确认用途并备份，不能按新库流程覆盖。`192.168.1.123` 为内网地址，执行端需要局域网或 VPN 可达。

当前工作区有未提交与未跟踪变更。部署前固定交付范围，生成可追溯的发布包或提交版本；不能假定远程 git clone 已包含本地全部页面与测试。发布包排除 `.env*`（保留 `.env.example`）、`node_modules`、`dist`、`.scratch`、日志与测试结果，不复制本地凭据。

## 3. 目录与权限

```text
/opt/ai-research-company/
  releases/<发布编号>/application/  # 源码、锁文件、构建产物
  current -> releases/<发布编号>   # 当前版本
  shared/app.env                  # 应用配置，应用账号可读，权限 0600
  shared/attachments/              # 私有附件，应用账号可读写
  infra/compose.yaml              # 此环境专用数据库及可选 Redis
  infra/.env                      # 容器凭据，0600
  data/postgres/                  # 独立持久化数据
  data/redis/                     # 启用 Redis 时持久化数据
  backups/                        # 数据库、附件、密钥的受控备份
```

使用独立无登录账号 `ai-research` 运行应用。root 负责安装、Nginx、systemd 与容器管理；应用账号不授予 Docker 管理权限。每个发布目录的 `application/.env` 链接到 `shared/app.env`，systemd 与 npm 均从同一份配置启动。数据库目录权限按所选容器用户配置，不整体递归改成应用账号。

## 4. 数据服务

另外创建此环境的 Compose 文件，不直接拿仓库的自动化测试 Compose 当手工验收库：

| 服务 | 建议配置 |
| --- | --- |
| PostgreSQL | 仓库基线 PostgreSQL 17.6；数据库 `acquisition_uat`；角色 `acquisition_uat`；宿主机仅绑定 `127.0.0.1:55434`；数据映射至 `data/postgres`；配置健康检查与重启策略 |
| Redis（可选） | 仓库基线 Redis 8.2；仅绑定 `127.0.0.1:56380`；AOF 持久化至 `data/redis`；配置健康检查与重启策略 |

镜像先验证服务器可拉取，再记录实际镜像版本/摘要。数据库密码单独随机生成，不复用 SSH 密码。自动化测试另建可丢弃的 `acquisition_test` 数据库，不使用 `acquisition_uat`。不要执行删除验收数据卷的命令。

## 5. 应用配置

`shared/app.env` 示例，所有占位值在服务器填写：

```dotenv
NODE_ENV=development
PORT=3000
APP_ORIGIN=http://192.168.1.123:8080
DATABASE_URL=postgresql://acquisition_uat:<URL编码后的数据库密码>@127.0.0.1:55434/acquisition_uat
ORG_CONTACT_KEY=<独立随机32字节的64位十六进制值>
SMTP_CREDENTIAL_KEY=<另一独立随机32字节的64位十六进制值>
COMPANY_ATTACHMENT_STORAGE_DIR=/opt/ai-research-company/shared/attachments
COMPANY_ATTACHMENT_SCANNER=/usr/bin/clamscan
COMPANY_ATTACHMENT_SCANNER_ARGS=["--no-summary"]
REDIS_URL=
TENGDAO_BASE_URL=
TENGDAO_API_KEY=
TENGDAO_BUSINESS_DAILY_LIMIT=
```

两把密钥分别生成并安全备份，同一数据库后续部署必须保持一致；不能每次部署重新生成。数据库密码在连接串中进行 URL 编码。配置不放入发布包、日志或 Git。

扫描器路径为拟采用方案，需要先安装 ClamAV、更新病毒库，再以应用账号验证正常文件通过与测试恶意样本拒绝。不能使用永远返回成功的脚本代替扫描器。扫描程序或病毒库不可用时，附件上传验收不通过。

不接腾道时，以上四个相关变量必须全部留空（包括样例中原本有值的 `REDIS_URL`）。接入时四项必须完整，Redis 指向本环境地址，日额度以供应商合同为准；启用后的测试可能消耗真实供应商额度。

SMTP、U-Mail 页面配置成功不等于真实发信联调成功；当前启动装配使用延后接入适配器，实际投递、回执及收信需另行确认代码能力与供应商联调范围。

## 6. 首次安装与启动顺序

1. 核查服务器现状，准备目录、应用账号、基础软件和独立数据服务，等待数据库健康。
2. 上传固定版本的发布包并解压，记录发布编号及代码版本；创建配置链接和私有附件目录。
3. 在发布目录 `application/` 以应用账号安装和检查：

   ```sh
   npm ci --include=dev
   npm run typecheck
   npm test
   npm run deploy
   ```

   `deploy` 会检查配置、执行构建，再写入数据库初始化。只对确认过的专用新库首次执行；不是通用的旧库升级工具。构建需要开发依赖，因此安装时不能先省略它们。任一步失败即停止发布。
4. 首次成功后设置 `current` 链接，配置以下 systemd 单元（实际 Node 路径以服务器安装结果为准）：

   ```ini
   [Unit]
   Description=AI Research UAT
   After=network.target docker.service

   [Service]
   Type=simple
   User=ai-research
   Group=ai-research
   WorkingDirectory=/opt/ai-research-company/current/application
   ExecStart=/usr/bin/node --env-file=/opt/ai-research-company/shared/app.env dist/server/main.js
   Restart=on-failure
   RestartSec=5
   UMask=0077

   [Install]
   WantedBy=multi-user.target
   ```

   保存为 `/etc/systemd/system/ai-research-uat.service`，执行 `systemctl daemon-reload` 和 `systemctl enable --now ai-research-uat`。Docker 服务顺序不保证数据库健康，容器健康检查、应用失败重试和重启验证需一起验收。
5. 添加独立 Nginx 站点，不覆盖已有站点；以下为 HTTP 内网验收配置：

   ```nginx
   server {
       listen 8080;
       server_name 192.168.1.123;
       client_max_body_size 28m;
       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       }
   }
   ```

   全部路由转给 Nest，由现有路由白名单处理刷新；上传限制与应用现有 28MB JSON 接收限制匹配。Nginx 使用默认日志字段，不增加 Cookie、认证头或请求体记录。执行 `nginx -t` 通过后 reload；防火墙向测试来源开放 TCP 8080 与管理访问，不开放数据库、Redis 和应用内部端口。代理头不自动赋予应用信任，现有限流可能按代理地址聚合，验收时记录多人登录影响。

## 7. 验收清单与交付

| 场景 | 通过标准 |
| --- | --- |
| 首页、刷新与深链 | 浏览器打开入口，静态资源正常，已登录角色刷新其业务路径可用，无跨源错误 |
| 身份 | `super_admin` 首次登录、强制改密、重新登录、退出与过期门禁符合规则；初始凭据按既有身份决策受控交付，不写本文 |
| 开户与权限 | 平台创建下级、下级首次改密；不同角色越权请求被拒绝；核对最终参数值与来源 |
| 业务需求 | 按本轮需求逐项执行订单、点数、账务、企业档案、成员等相关允许/拒绝路径，记录业务结果；菜单可见不表示功能已验收 |
| 附件 | 正常文件上传、鉴权下载、越权拒绝、扫描拒绝路径；私有文件没有静态直链 |
| 上游 | 未配置时明确不可用；配置后验证真实查询、配额及失败路径；发信单独记录联调证据 |
| 持久化 | 服务与服务器重启后应用恢复，数据库与附件保留，密钥一致 |
| 自动化 | 仅在独立测试库按受影响场景运行集成/浏览器测试；默认测试脚本不代表覆盖全部业务 |

交付记录应包含入口、代码版本、镜像版本、执行命令、用例及实际结果、备份位置和未通过项，不含秘密。当前尚未验证：服务器连接与系统资源、软件安装、端口、数据库初始化、反向代理、浏览器业务流程、供应商、扫描器和重启恢复。

## 8. 后续更新、备份与回退

日常及每次更新前，保存一致的 PostgreSQL 备份、附件与原配置密钥。通过维护窗口暂停写入或其他一致性措施协调数据库与附件备份，并实际演练恢复到独立环境。

无数据库结构变化的发布：准备新发布目录 → 使用原密钥与配置完成构建检查 → 备份 → 切换 `current` → 重启 → 业务验收。失败时切回旧发布目录并重启。首次安装没有旧版本可回退，应停服务并保留故障现场，不清库重试。

存在数据库结构变化时，先单独制定并验证迁移及恢复方案。当前 `db:migrate`/`deploy` 是新库初始化入口，不提供任意版本升级和回滚保证；不能仅切换代码就宣称数据库已回退。
