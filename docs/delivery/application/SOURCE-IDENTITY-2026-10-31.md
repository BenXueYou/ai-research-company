# 来源定位规格同步与票03～05实施记录

日期：2026-10-31。当前工作区增量修改，未提交、未部署、未调用正式供应商、未发送邮件。票03原有未提交实现、票04候选组修复及验证入口修复均保留。本次没有改写历史草稿。

## 规格与票据

- Spec v1.4、技术设计 v3.5、实施依赖 v1.1；新增[来源定位决策](../../decisions/002-company-source-identity.md)，CONTEXT仅增加领域词汇。
- 更新本地现行票03～06，票08/09及16/17补引用及验收场景；其他现行票仅更新共同基线版本。票04与03共享来源归属串行集成。
- E04分记录定位、唯一企业、跨日稳定性和联系人归属。用户两次实测作为样例结论保存；仓库未取得准确请求原文，正式 recordLookup 不启用。并未通过重新调用收费接口补证据。

## 实施

- `company-sources.ts`：服务端来源候选列表、有版本的选择、请求幂等、租户/停用/删除/来源/国家校验、显式展示切换。选择只令身份保持pending；不写操作准入证据。
- `company-source-details.ts`：领域级精确记录Adapter，报价前能力检查、锁定请求快照、冻结前重验、按查询防重、独立详情快照和result_state。A/B不自动合并，返回ID/国家冲突不发布；不同来源保留快照，首份资料或同一展示记录更新可发布，其余显式切换。接口实际参数仍由有证据的Adapter决定。
- 新增独立操作证据及版本检查：联系人报价/执行、邮件预览/确认/批次授权/逐项提交/重发/跨日重确认。受控证据仅非生产接受；默认verified不证明准入。尚无正式证据登记工作流和历史证据回填流程，不可据此上线放行旧客户。
- 精确记录与旧名称详情入口隔离；选择来源后旧名称报价/刷新/执行不能绕过来源路径。既有结算适配精确查询，结果证据不一致拒绝覆盖；最终失败保留已发布快照。
- `company-source-schema.ts`及升级执行器新增票02→来源版本升级路径，旧结构快照、当前结构校验、幂等和复合租户外键。保留旧档案及详情投影，不自动合并或伪造准入证据。
- 原详情页新增模块内`CompanySourcePanel`，使用ElSelect和默认表单控件；展示资料选择、报价确认、查询进度和多个来源快照。未决查询通过显式状态读取恢复，费用未决不锁其他档案操作。
- 票03产品词候选不可见：已定位为ElCheckboxGroup默认line-height:0被业务名称继承，最小浏览器复现测得名称高度0；只为业务名称补line-height:1.65后高度23.09px，保留控件默认样式及所有取值。

## 契约与实测

| 链路 | 实际取值及结果 |
| --- | --- |
| 公司名关联 | 浏览器sourceRecordId=`346206ec-e85b-492b-aa97-6a1db914ff97`（本地候选），供应商ID=`vendor-list-111`；确认profileId=`e87a449c-8ce9-4c53-995e-825d992b46f8`来自展示候选，未拿供应商ID替换 |
| 产品词关联 | 销售账号sourceRecordId=`e3baced0-a777-4da4-a6cd-0fb70142dbbd`（本地产品候选），确认同一profileId；搜索条件TUR及贸易日期原值保留 |
| 历史保全 | 原detail_id=`detail-data-222`；内部联系人=`1b8122b3-8006-4998-a141-9fd4d660f388`、mailsouId=`mailsou-444`、payload.id=`contact-source-555`、fileId=`contact-file-666`分别保留；manual preserved及history preserved原值保持 |
| 关联成本 | 公司名保存前后账务和查询流水不变、名单调用1次；产品词查询扣0.4321后保存/关联不新增扣费、产品调用1次。中间显式详情查询冻结1.0000，不混算为保存成本 |
| A/B精确查询 | 受控HTTP中本地UUID与source-A/source-B不同；Adapter分别收到recordId=source-A/source-B，name=SEOUL SEMICONDUCTOR、countryCode3=KOR，返回id各与recordId一致。默认复用和重复执行不新增调用 |
| 结果与费用 | A/B返回无actualUpstreamPoints，resultState=ready、state=pending；余额100.0000保持，冻结2.0000。A保持展示直到用户选择B；人工内容不变 |

## 验证结果

使用专用 Docker PostgreSQL 17.6 `company-source-0431-test` / `company_sources_test`，真实Nest HTTP及Chromium，供应商与邮件均受控。浏览器脚本校验专用库后缀并清空该专用schema，不能指向业务库。

1. `node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.server.json --test --test-concurrency=1 tests/company-sources.test.ts server/issue03-profile-association.test.ts tests/issue04-candidate-groups.test.ts`：**整体失败，不能标通过**。共运行三次，每次票03、候选组、迁移三项通过；HTTP项依次停于夹具职位枚举CEO无效、停用返回401而预期403、邮件批次成功返回201而预期200。三项夹具已修正；依据工程脚手架“相同命令最多修正并重跑三次”停止重跑。第三次已走过邮件缺证据预览拒绝、受控证据预览、确认及批次建立；其后的身份变化发送拒绝等断言未执行。
2. 第二次HTTP已走过A/B快照、精确参数、人工资料、缺证据联系人拒绝、受控准入与生产拒绝、版本变化联系人拒绝、ID/国家不符、零结果、过期选择、删除及停用拒绝；但套件最终失败，后续改动未复验。第三次新增CSRF、跨组织读取及并发同请求选择断言已执行。
3. `node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.server.json tests/company-source-browser.test.ts`：**第三次通过**。第一次账号退出后未等待登录页；第二次复现产品词业务文字零高度；修复后管理员公司名关联→详情选择/获取/展示→销售产品词关联全部通过。1440/900/390三宽度截图人工查看，两个关联区域及来源面板均可读，无文档横向溢出。属于真实业务页面验收；页面其他区域及完整多来源切换矩阵不在本次浏览器断言范围。
4. `npm run build`：通过（Vue类型检查、Nest编译、Vite构建），既有大包警告。最后新增重发/重确认及旧详情入口校验后再次`npm run typecheck`通过。随后结算保留已发布结果的SQL修订仅静态检查，未执行数据库场景。
5. `git diff --check`：通过。新增测试加入.gitignore例外及package.json稳定入口`test:company-sources`、`test:company-sources:browser`；未借新别名绕过重跑次数限制。

## 票据状态与待完成

- 票03：本地显式关联范围验证补齐；跨来源自动识别保持关闭，不能据此宣称E04完成。
- 票04、05：in-progress，已实施上述闭环，**未完整验收**。操作证据登记及历史证据核实尚未形成业务闭环；产品词初始档案的候选核实仍从搜索页进入；尚未完成断线重启恢复、所有并发和失败顺序、自动结算及正式Adapter证据。
- 迁移测试在增加最终复合外键前通过；最终外键、发布时追加来源/停用重验、旧名称入口防绕过、对账冲突及最终失败保留、重发/跨日准入新增检查未再跑运行时回归。票02baseline夹具已适配新版本，但本轮未重跑该专项。
- 邮件最终发送拒绝、真实投递、联系人完整业务回归、旧客户准入回填、准确HTTP ID参数与跨日真实观察均未验收。不得将构建或浏览器局部通过当成以上流程通过。
- 旧业务数据未升级；没有运行deploy或使用业务数据库。应用/浏览器已关闭，专用数据库容器已停止。包含删除容器及专项截图/构建目录的清理命令被执行策略以“blocked by policy”拒绝，未删除；停止的`company-source-0431-test`及`application/.scratch/company-sources/`保留。稳定测试源码及本文证据保留，原先票03工作区产物未动。

## 前端编码规范试点交付反馈

- 规则版本：0.0.1；触发：自动。
- 应用：ACTIVE MUST FCS-007/011/013/019/020～027/029/030及相关GUIDANCE；保留原目录职责、显式组件引入与Element Plus默认外观。
- 校验：Vue/服务端类型检查及构建通过；真实页面浏览器最终通过；综合HTTP失败及未执行范围见上文。未发现项目lint/格式化脚本，不新增扫描工具。
- 冲突：无；未触及的既有页面样式不扩大整改。
- PENDING：命名、SFC块顺序等沿用仓库现状，无需用户补充决策。
