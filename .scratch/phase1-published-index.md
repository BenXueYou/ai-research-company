# 第一期 tickets 发布索引

父规格：https://github.com/BenXueYou/ai-research-company/issues/1

状态：32张已于原发布轮次发布并验证。2026-10-27本地实施基线已修订为Spec v1.2、PRD v3.2、技术设计v3.3及已批准身份决策，见[拆票实施基线](./phase1-ticket-plan.md)。线上父Issue及子票仍为旧基线，尚待同步；本次未修改线上正文、状态或依赖。

| 草案编号 | GitHub Issue | 阻塞项 |
|---|---|---|
| T01 | [#2 平台账号登录、强制改密与本人改密](https://github.com/BenXueYou/ai-research-company/issues/2) | 无票间依赖 |
| T02 | [#3 直属组织开户并交付首位管理员凭据](https://github.com/BenXueYou/ai-research-company/issues/3) | #2 |
| T03 | [#4 企业成员开户、临时密码交付与停用](https://github.com/BenXueYou/ai-research-company/issues/4) | #3 |
| T04 | [#5 按管理关系重置及补发临时密码](https://github.com/BenXueYou/ai-research-company/issues/5) | #4 |
| T05 | [#6 指定运维核验后恢复平台管理员](https://github.com/BenXueYou/ai-research-company/issues/6) | #2 |
| T06 | [#7 平台采购入账、用途区分及基础计价配置](https://github.com/BenXueYou/ai-research-company/issues/7) | #2 |
| T07 | [#8 直属点数订单确认收款并原子预留](https://github.com/BenXueYou/ai-research-company/issues/8) | #3、#7 |
| T08 | [#9 完整划拨一次并核算买入成本与历史毛利](https://github.com/BenXueYou/ai-research-company/issues/9) | #8 |
| T09 | [#10 已收款未划拨订单的线下整单退款](https://github.com/BenXueYou/ai-research-company/issues/10) | #8 |
| T10 | [#11 按公司名免费找企业与身份核实](https://github.com/BenXueYou/ai-research-company/issues/11) | #3 |
| T11 | [#12 单独确认企业详情费用并建档](https://github.com/BenXueYou/ai-research-company/issues/12) | #7、#11 |
| T12 | [#13 按产品词、企业所在国和贸易时间找候选](https://github.com/BenXueYou/ai-research-company/issues/13) | #12 |
| T13 | [#14 未决查询人工核对、退款及迟到结果处理](https://github.com/BenXueYou/ai-research-company/issues/14) | #12 |
| T14 | [#15 档案内逐页获取联系人与归属标记](https://github.com/BenXueYou/ai-research-company/issues/15) | #12 |
| T15 | [#16 主动更新企业及联系人并保留历史](https://github.com/BenXueYou/ai-research-company/issues/16) | #15 |
| T16 | [#17 共享档案补充、状态筛选及软删除恢复](https://github.com/BenXueYou/ai-research-company/issues/17) | #12 |
| T17 | [#18 回复摘要、备注与 WhatsApp 人工时间线](https://github.com/BenXueYou/ai-research-company/issues/18) | #12 |
| T18 | [#19 档案及人工记录附件的私有留档](https://github.com/BenXueYou/ai-research-company/issues/19) | #18 |
| T19 | [#20 国内 SMTP 团队渠道设置与回复地址](https://github.com/BenXueYou/ai-research-company/issues/20) | #3 |
| T20 | [#21 U-Mail 企业资源与域名渠道设置](https://github.com/BenXueYou/ai-research-company/issues/21) | #3 |
| T21 | [#22 收件人准入、去重冲突与本次邮件预览](https://github.com/BenXueYou/ai-research-company/issues/22) | #15 |
| T22 | [#23 经国内 SMTP 手动单轮发送并共享企业日额度](https://github.com/BenXueYou/ai-research-company/issues/23) | #20、#22 |
| T23 | [#24 经 U-Mail 发送同一单轮流程并跨渠道共享额度](https://github.com/BenXueYou/ai-research-company/issues/24) | #21、#23 |
| T24 | [#25 邮件证据核对、可信送达与手动重发确认](https://github.com/BenXueYou/ai-research-company/issues/25) | #23 |
| T25 | [#26 邮件跨日暂停、次日重确认与原日迟到核对](https://github.com/BenXueYou/ai-research-company/issues/26) | #23 |
| T26 | [#27 组织停用时协调在途查询、邮件及待划拨订单](https://github.com/BenXueYou/ai-research-company/issues/27) | #8、#12、#23 |
| T27 | [#28 系数变更通知、生效与全链额度覆盖核验](https://github.com/BenXueYou/ai-research-company/issues/28) | #9、#12 |
| T28 | [#29 终端用量、分销交易利润与平台全链查看](https://github.com/BenXueYou/ai-research-company/issues/29) | #9、#14、#23 |
| T29 | [#30 平台上游余额、有效期、配额与异常监控](https://github.com/BenXueYou/ai-research-company/issues/30) | #11 |
| T30 | [#31 腾道正式联调：候选到联系人与账单闭环](https://github.com/BenXueYou/ai-research-company/issues/31) | #13、#14、#15、#30 |
| T31 | [#32 国内 SMTP 正式联调：投递、回复实收及失败证据](https://github.com/BenXueYou/ai-research-company/issues/32) | #25、#26 |
| T32 | [#33 U-Mail 正式联调：资源隔离、内容生效与回执](https://github.com/BenXueYou/ai-research-company/issues/33) | #24、#25、#26 |

原发布时所有票均标记ready-for-agent。2026-10-27用户取消平台管理员恢复：本地T05已撤出一期，线上#6尚未更新，保留历史编号不代表当前需实施。旧发布脚本仍按32张活动票及旧验收生成正文，未经更新不得用于本轮同步；其解析器当前不接受T05撤销状态。
原生阻塞关系：原发布轮次全部建立并回读验证；本次文档修订不改变票间依赖，也未重新验证原生关系。

本次只发布tickets，未实现代码、运行生产验收、真实扣费查询或发信。
