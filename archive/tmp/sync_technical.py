exec((__import__('pathlib').Path(__file__).parent/'sync_docs.py').read_text(encoding='utf-8').split('updates=')[0])
def section(start,end):return tech[tech.index(start):tech.index(end)].strip()
api=section('### 2.1 统一响应解析','### 2.8 计费与点数记账')
api=api.replace('`pageSize` 建议取 1,000 以上。','`pageSize`须按具体接口限制与本页费用确认确定，禁止统一使用大页或自动拉满。历史性能建议不构成当前默认值。')
api=api.replace('主动拒绝新任务并顺延次日','主动拒绝新请求，次日由用户重新确认计费页')
api=api.replace('**单页取满再翻页**。','**每次只取用户确认的一页**。')
api=api.replace('`pageSize` 取小纯属浪费配额。','页大小不能以节省配额为由绕过用户本页费用确认。')
api=api.replace('有限次数指数退避重试，记录请求上下文','计费请求进入结果确认中，先核对，不盲目重试；只读免费接口可采用有界退避')
cross=section('### 4.3 企业接口参数差异','## 五、接口清单与映射')
cross=cross.replace('**逐条核对 `companyName` 后再入库**。与查询名称不同是常态','保留返回companyName及核对结果；不一致标记归属待核实、默认不选，逐条人工确认说明后才可入收件人')
mapping=section('## 五、接口清单与映射','## 六、关键流程设计')
mapping=mapping.replace('进口商纯名单（D-06，省点数）','产品词最小进口商候选（D-11，第一阶段）').replace('出口商纯名单（D-06，省点数）','出口商纯名单（D-06，第二阶段）')
mapping=mapping.replace('只要公司名单（如批量导出给后续富化流程），**点数消耗最低**','第一阶段产品词发现只取进口商候选名称；不是完整身份，无country；单价未核实，不承诺最低成本')
mapping=mapping.replace('批量名单导出用 `-name` 省点数','第一阶段最小进口商候选用 `-name`，禁导出；成本以商务配置与实际账单为准')
mapping=mapping.replace('单次成本通常远低于明细查询','不能据此推断具体成本高低，仍需独立单价配置')
append=tech[tech.index('## 附录 A：'):].strip()
append=append.replace('### 场景四：跨库到企业与联系人','### 场景四：跨库到企业与联系人（仅请求形状示例，实际各计费步骤须单独确认）')
content=f'''# 智能获客系统 · 技术设计文档

版本 **v3.0，2026-10-26**。以05全部已确认规则和06邮件核对为准，与PRD v3.0、功能清单133个登记编号同步。本文为设计与契约整理，未部署、未使用正式账号联调；旧示例金额、缓存TTL与重试建议不自动成为业务默认值。

## 一、阶段架构与职责

第一阶段：单HTML交互原型；后续应用技术栈另按工程选型落地，不在本任务迁移框架。后端采用模块化业务服务、PostgreSQL、Redis、私有对象存储；ES、地球可视化与完整贸易分析后置。所有腾道访问共用平台API账号，由独立适配层负责令牌、逐接口DTO、参数校验、账号合并限流、响应与账单核对。

```text
终端六入口 / 分销三入口 / 平台运营
          → BFF鉴权、角色与tenant_id权限、审计
          → 组织与直属交易 / 查询授权与冻结 / 企业档案与联系人 / 邮件单轮发送
          → PostgreSQL(原始数据按企业隔离、账务、状态机、Outbox)
          → Redis(共享账号令牌、限流、幂等) / 私有对象存储
          → 腾道适配器(统一平台账户)
          → 国内SMTP适配器 / U-Mail任务API适配器(按企业隔离)
```

完整贸易服务与送达检测第二阶段；AI/Agent/WhatsApp主动触达第三阶段条件规划。第一阶段D-11产品词最小进口商候选不等于提前完整贸易页。原独立线索池取消，候选在搜索结果，建档后在档案库；K组进入档案联系人页签。分销端下级管理、点数订单、交易与利润；终端入口与权限见PRD第二章。

## 二、权限与数据边界

| 主体/对象 | 服务端规则 |
|---|---|
| 终端管理员/业务员 | 同企业全员可查看补充全部档案；不按owner/部门隔离。管理员直接创建、重置、停用成员，不做邀请流程 |
| 档案 | 仅企业管理员软删除和恢复；成员可修改补充；记录操作人时间 |
| 人工时间线记录 | 仅创建人编辑，企业管理员软删除；全员可看不等于可改他人记录 |
| 系统邮件记录 | 不能手动修改删除，系统依据渠道证据更新状态并保留依据 |
| 附件 | 第一阶段仅上传下载、企业管理员软删除；原白名单、20MB/文件、50/企业、MIME校验保留；无预览重命名替换，单附件恢复未确认 |
| 分销管理员 | 查看权限范围下级开户、余额、交易及汇总用量；关键词、目标企业、联系人和邮件内容不得通过列表、日志或导出泄露。只操作直属下级开户、定价、收款和划拨 |
| 平台运营 | 可看全链账务及终端客户档案、邮件内容。查看是角色例外，不自动授予跨企业修改/删除/发信权或跨级交易权 |
| 原始数据与缓存 | key含tenant_id；本企业本地查看不收费；不同终端企业不复用。主动更新须重新确认费用，TTL到期不自动付费刷新 |
| 导出 | 腾道企业/联系人/贸易禁止所有形式导出下载；平台自有账务可导出，分销导出不得夹带下级业务字段；自上传附件按私有下载规则 |

最多两级分销：平台→一级→二级→终端，可短链直开终端；二级不得再建分销。组织上级不可迁移，换合作另开户且不自动转余额数据。停用本组织登录与新业务，保留数据余额；不自动级联停用下级，直属上下级交易暂停，正常启用的下级仍可向自己下级销售。终端停用停止尚未执行请求；在途只核对不自动重试，按原授权结算。已收款订单暂停并保留销售预留，退款须另行处理。

## 三、数据模型与不变量

以下为逻辑字段设计，不伪造已存在数据库或接口实现；所有组织/成员/业务对象关系在服务端校验。

| 表/聚合 | 关键字段与不变量 |
|---|---|
| organization | id,parent_id,kind,distributor_level,status；开户后parent_id不可改；最多两级分销；成员不计级数 |
| internal_point_account | organization_id,balance,query_frozen,sales_reserved；可用=余额-查询冻结-销售预留，balance包含未消耗的受限部分，不重复相加。点数NUMERIC支持4位小数，不可用二进制浮点记账；无有效期 |
| point_purchase | purpose,upstream_points,coefficient_snapshot,generated_internal_points,amount；销售用途按入账系数生成库存；补缺口/失败/超额成本充值生成量为0，分别留账 |
| point_order | seller_id,buyer_id,quantity,unit_price,amount,state,receipt_reference,cost_snapshot,markup_snapshot；一单一笔足额收款一次完整划拨；款项引用不可复用。数量售价确认收款后锁定 |
| point_ledger | account_id,operation_id,type,amount,available_before/after,query_id/order_id,actor_id,occurred_at；唯一操作键、只增不覆盖；冻结、释放、结算、退款可追溯 |
| query_authorization | tenant_id,user_id,interface_path,selected_source_snapshot,request_snapshot,page_no,page_size,unit_price_version,coefficient_snapshot,max_internal_points,confirmed_at,state；逐步逐页授权，快照不可被后续配置改写 |
| query_execution | query_id,trace_id,upstream_deduct_points,billing_quantity,result_reference,state,reconciliation_evidence,operator,time；结果能否查看与上游扣费分别记录；最终失败后的迟到结果不重启结算 |
| company | id内部主键,tenant_id,tendata_company_id←data.id,name原始名称,country_code3,source_payload,fetched_at,customer_status,star,tags,deleted_by/at；身份核对后建档，本企业内去重。data.id判空，不能用tradeStats或contactMethods |
| company_supplement | company_id,main_products,purchase_needs,cooperation_intent,next_follow_up_at,updated_by/at；固定字段，与源数据分区，无自定义字段；跟进日期仅筛选展示 |
| search_candidate | tenant_id,query_id,source_name,selected_identity,verification_state,verification_note；贸易-name返回只有name，身份未知候选不得直接当档案或发信企业 |
| contact | id内部主键,tenant_id,company_id,mailsou_id←mailsouId,query_company_name,returned_company_name,email,personal_emails,position_tag,credibility,source_payload,fetched_at,missing_from_latest_update；保留旧联系人与沟通，不推断离职 |
| contact_ownership_confirmation | contact_id,company_id,source_returned_company_name,confirmed_by,reason,time；归属不一致默认不选，逐条确认说明独立留存，不覆盖原始归属 |
| timeline_manual_record | id,tenant_id,company_id,type,event_time,contact_or_phone_enc,content,created_by,updated_at,deleted_by/at；类型为回复摘要/备注/WhatsApp；WhatsApp表单仅时间、联系人或号码、摘要、附件，无方向/结果/我方账号 |
| company_attachment | id,tenant_id,company_id,communication_id可空,original_name,storage_key,mime_type,size_bytes,sha256,scan_status,uploader_id,deleted_by/at；私有桶、服务端生成key、MIME+扩展名、短时签名访问、审计 |
| team_sending_channel | tenant_id,kind(SMTP/UMAIL),credential_reference,reply_to,verification_state,default_flag；唯一(tenant_id,kind)，每渠道最多一套；凭据仅服务端密钥引用 |
| public_template | id,version,subject,content,preset_attachment_refs；平台预配公共模板；发送时创建本次快照，不回写原模板 |
| email_batch | id,tenant_id,company_id,actor_id,channel_id,content_snapshot,template_version,state,quota_date,confirmed_at,provider_task_id；一批固定渠道身份，单轮手动 |
| email_recipient | id,batch_id,contact_source_id,selected_email,chosen_variable_source,rendered_snapshot,unsubscribe_confirmation,provider_id,state；按最终邮箱去重，变量冲突不能自动首条；联系人标识与邮箱分别存 |
| email_daily_quota | tenant_id,beijing_date,configured_limit,reserved,used；两渠道团队共用，reserved+used≤limit，原子占用；额度不关联查询点数 |
| email_quota_event | batch_id,recipient_id,quota_date,type,quantity,evidence,time；跨日和迟到核对归原日期，事件幂等 |

货币、每点售价、换算系数精度未定，不擅自写死；内部点数统一四位小数。分销剩余库存移动加权平均成本在每次买入后更新，已售历史成本毛利不重算；平台自身成本口径与补缺口成本归集待定。

## 四、查询与点数状态机

1. 公司名走免费company/list；产品词走D-11最小名单，必须国家+时间+产品词。国家业务目标是采购企业所在国家，映射未核实前生产计费入口不可假定已就绪；不能把countryOfDestinationCode直接当等价映射。
2. 用户只选一候选；多匹配或国别冲突需人工核实。详情name取已确认企业列表name，countryCode3取核对的三位国家；响应不一致阻止入库及后续，不能由人工选择豁免强校验。
3. 接口单价未配置则阻止计费查询；报价按本页可证明的最大计费条数及单价、系数形成上限，算法和限制需联调。row-count只提供对应贸易条数，不是企业/联系人通用报价接口，扣点流水是事后核对。
4. 每页用户确认后锁系数、最高额度与条件，原子冻结终端内部点数；可用不足不调用。详情、联系人和下一页分别授权，不默认全页候选建档或自动抓全量。更新数据须重新确认。
5. 待执行→执行中→成功/零结果/结果确认中；只有最终无法提供结果才失败。可查看成功费用=min(ROUND(本页腾道实际扣点合计×锁定X,4),已确认最高额度)。先汇总再取整，不逐条取整。
6. 成功结算释放差额；真实零结果、最终失败全部释放或退回已扣；电话网址缺失、联系人无邮箱而可查看仍结算。上游费用或超额由平台承担，名单成功费用不因后续匹配失败而退回。超额后未执行后续查询暂停重新确认。
7. 超时/保存结果不确定→结果确认中并保留冻结，不盲目重试。长期未决交平台人工核对，留依据/人/时间，期限按实测账单延迟确定。最终失败退款后迟到结果保留但不再次扣点。

query_id+确认版本+页码为执行幂等边界；事务与Outbox保证冻结授权再调用，回执/账单补偿必须幂等。所有终端查询只动本终端账户，上游平台账户扣费另记，不再次扣上级库存。冻结与销售预留都属于余额中受限部分，不可重复累加。

## 五、点数订单、定价与覆盖

未收款→确认收款并预留→已收款待划拨→已划拨；退款支线仅已收款待划拨→卖方确认线下整单退款→关闭并释放预留。禁止分期、拆分划拨、合并付款、重复划拨、款项复用。已划拨不支持普通退款/冲销。相关组织停用暂停划拨，不自动退单或释放。

确认收款事务中校验直属关系、双方启用、最新库存成本及m下限、足额款项与库存；库存不足不完成系统收款确认，并提示线下款项可能已到账。补库存或线下退款处理尚未决，不假装未到账。划拨只将卖方预留转移到买方，一减一增不重复扣减，内部划拨不调腾道。

分销每次买入：新平均成本=(买入前剩余库存成本+本次采购成本)/(剩余点数+买入点数)。未收款按新成本和m校验，旧价不足阻止并让上级重新定价，不自动涨价；已收款按锁定数量售价履约，成本变化差额卖方承担。m全局一个，实际值待配置，名称为最低加价率，不能称净利润率。

X平台统一默认1，新生效不改已有余额，已确认查询锁旧X。降低X前按全链未消耗点数含预留冻结去重核算覆盖；旧授权按旧系数，其余按拟新系数，区分上游已扣本地未结算在途项。覆盖不足先补上游再生效；补缺口充值不增发内部库存。普通销售用途采购按入账X生成内部库存，后续X变更不重算该库存。

## 六、邮件发送与额度状态机

### 6.1 接入与契约

每企业国内SMTP、U-Mail域名渠道各最多一套；平台统一采购U-Mail并隔离企业资源，第一阶段平台承担服务费，终端企业配合域名验证。两渠道都配置真实可收信回复邮箱，回复在原邮箱查看，不做IMAP/POP3收件同步。默认渠道可配置，每批固定选一个，不能自动轮换或失败跨渠道重发。

U-Mail优先评估上传地址池/模板/建立任务API执行本次单轮；这是接入建议，隔离能力及小批量路径未联调。普通国内SMTP是独立适配器，不能把U-Mail smtp.php当任意邮箱SMTP。DNS实际记录取供应商配置，专用发信子域名为建议，不盲改在用主域MX。

V29 PDF 122页，重点参照06与PDF第60/65页：smtp.php参数原文为 **relpy_to**；**tpl_id同时提供时优先于subject/content**。为保留本次编辑，适配器必须验证任务API使用本批内容快照/隔离模板的具体路径；不能把公共tpl_id和已修改content同时提交并误以为编辑生效。SMTP和API统计能力有差异，只回写可证明的状态；PDF smtp.php附件总量40M为供应商约束，不自动变成本产品上传默认值或可临时添加附件的权限。

### 6.2 选择到提交

档案联系人→核实归属→企业邮箱默认、个人邮箱显式选择→退订默认不选但可确认提示后重选→按最终邮箱去重→同邮箱变量冲突由用户选择来源→公共模板复制为本次内容→变量渲染校验、预览→确认渠道和额度→入队。缺变量或未替换阻止，不扣点；保存预览发送不回写公共模板；仅预设附件，不接档案附件或临时附件。

退订仅本地标记，不做全局或企业范围强制屏蔽；上游黑名单、退订及拒投仍须尊重，不能另建账号绕过。标记归属范围、邮箱等价标准待定；不能以猜测的大小写或别名规则合并邮箱。暂按完全一致的最终地址演示，生产归一化另验证。

### 6.3 状态与日期

排队中→已提交发信服务；明确未提交成功→发送失败；请求超时且受理不明→结果待确认，先核对不自动重发。只有可靠投递证据才可展示已送达；受理或任务发送完成不等于送达、阅读或回复。核对仍不明则提示可能重复，用户决定是否重发。回复摘要、已回复客户状态均人工登记，客户四状态不由邮件事件自动推进。

企业日额度按Asia/Shanghai北京时间零点重置，两渠道和团队共用，不累计。每批去重最终邮箱数在确认时原子预占；上游受理转已用，明确未提交释放，结果待确认保留预占。事件唯一键防重计。日上限按套餐实测配置，无真实默认值。邮件发送、模板预览与变量补全不扣查询点数。

跨日尚未执行的逐收件人邮件暂停并解除原日对应预占，次日须用户重新确认占新日额度。已提交结果不明保留原日预占核对，迟到结果在原日期转已用或释放，不占新日，也不因零点自动释放。平台上游服务额度与本地企业日额度分别约束，不能用本地额度代替供应商检查。

## 七、档案、时间线与附件流程

原始数据与人工补充分区；固定主营产品、采购需求、合作意向、下次跟进时间，自由备注承接其余信息。统一时间线四类：邮件、回复摘要、备注、WhatsApp，倒序+类型筛选；WhatsApp表单仅时间、联系人或号码、摘要、附件，号码保持加密脱敏。创建人编辑、管理员软删除；系统邮件只由系统核对更新。客户状态线索/跟进中/已回复/无效手动调整，保留人和时间。

附件上传先校验当前企业权限及communication_id同企业，前端校验只作反馈，服务端再次白名单+MIME、原大小数量上限；生成storage_key→私有存储→元数据，失败补偿避免半条记录。短时签名下载且记审计，不提供在线预览/重命名/替换；病毒扫描、私有访问和既有安全校验不因范围收窄而取消。档案附件不是邮件临时附件。

## 八、上线前业务验证（尚未执行真实联调）

- 不同企业同名数据与缓存相互隔离；分销API/对账导出不泄露下级客户；平台查看与修改授权分开验证。
- 原始候选名、列表ID、详情data.id、联系人mailsouId、个人邮箱各取不同值，逐步比较选择快照与最终参数来源；countryCode3与商品目的国刻意不同，确保不混用。
- 每页独立确认、下一页再次确认、未选候选不调用；免费公司列表不扣；接口未配价格阻止；失败/零结果/缺字段/无邮箱/超额/迟到结果各自结算。
- 同时查询不能超用余额；退款/回执重复幂等；降低系数含锁旧X冻结、销售预留和在途费用核对，不重复算覆盖。
- 收款与库存预留原子；不足库存但款已到账提示；未收款重验与已收款锁价；停用保留预留；整单退款、重复划拨、跨级操作拒绝。
- 两渠道资源隔离、回复邮箱实收、公共模板编辑生效、relpy_to原拼写、tpl_id优先级、真实状态回收与上游拒投。
- 同邮箱不同mailsouId变量冲突人工选择，个人邮箱不兜底，归属确认说明，退订默认不选与手动提示确认；变量未补全禁止发送。
- 两渠道并发共享日额度，受理/明确失败/不确定分别计量，北京时间23:59至00:00跨日未执行暂停与原日不确定核对。

本轮仅验证模拟原型、文档及Excel一致性，真实流程结论见07同步与验证清单。精度/成本/时限/覆盖/单价及06未决项保持待验证，不能使用旧文档建议默认值填空。

## 九、腾道接口契约资料（保留原字段；不代表本轮真实联调）

下列来自旧技术设计已整理的接口文档资料。保留请求字段、响应结构及枚举，不据此扩大第一阶段能力。限流实现余量等为技术建议，账号实际配额按商务验证；付费调用必须同时遵守第四章。

{api}

### 企业与联系人接口映射

{cross}

{mapping}

## 十、历史接口参考附录

以下错误码、字段和样例保留供逐接口核对。样例不是已执行请求，不授权自动批量拉取或绕过逐页费用确认；附录若给出分页批处理，仅属后续设计参考。所有商业单价、账号覆盖、时间跨度及字段实际填充仍待真实联调。

{append}
'''
(R/'03-技术设计文档.md').write_text(content,encoding='utf-8')
print('technical synced')
