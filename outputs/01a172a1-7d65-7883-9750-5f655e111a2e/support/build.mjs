import fs from 'node:fs/promises';
import {Workbook, SpreadsheetFile} from '@oai/artifact-tool';
const base = 'C:/PXY/ai-research-company';
const out = base + '/outputs/01a172a1-7d65-7883-9750-5f655e111a2e';
const groups = {
 F:['工程与部署','接口响应适配','请求参数校验','请求参数校验','请求参数校验','配额与计费','配额与计费','异常处理','接口响应适配','数据存储','数据存储','数据质量','监控与日志','安全管理','异常处理'],
 U:['账号与登录','账号与登录','组织与成员','权限管理','权限管理','操作审计'],
 D:['接口鉴权','贸易数据','贸易数据','企业数据','联系人数据','贸易数据','贸易数据','联系人数据','账户与账单','数据源管理'],
 H:['地图展示','搜索入口','搜索入口','搜索入口','搜索入口','数据概览','搜索辅助','潜客推荐'],
 T:['查询与筛选','查询与筛选','查询与筛选','查询与筛选','记录展示','记录展示','查询与筛选','查询与筛选','线索转化','数据导出','统计分析'],
 K:['联系人检索','联系人检索','联系人质量','联系人质量','联系信息','联系信息','联系人检索','线索转化','联系人质量'],
 C:['档案查询','档案详情','档案质量','档案质量','档案质量','档案详情','客户管理','客户管理','沟通与跟进','档案质量','沟通与跟进','附件管理','沟通与跟进','附件管理','权限与审计','沟通与跟进'],
 M:['邮箱账号','发送管理','发送管理','邮件内容','邮件内容','营销自动化','效果追踪','发送管理','发送管理','营销自动化','收件人管理'],
 S:['邮箱验证','邮箱验证','邮箱验证','发信环境检测','发信环境检测','检测用量'],
 A:['企业分析','企业分析','企业分析','企业分析','市场分析','获客分析','市场分析','内容辅助'],
 G:['任务自动化','任务自动化','动态监控','执行管理','执行管理'],
 B:['余额管理','余额管理','消费管理','消费管理','消费管理','消费管理','调用配额'],
 P:['通用界面','线索管理','邮箱管理','基础设置'],
 L:['数据关联','接口适配'],
 W:['号码采集','号码校验','添加辅助','使用确认']
};
const descriptions = {
 'F-03':'请求前校验 pageNo×pageSize ≤10,000 且 pageNo ≤1,000，超出范围时引导用户拆分查询条件。',
 'F-04':'按接口约定构造参数：数据源 country 和联系人 positionTag 用逗号分隔，hsCode 及业务国家码等用分号分隔。国家码使用 ISO Alpha-3，区间必须包含两个有效值。请求与响应字段独立映射（sumOfUSD / sumOfUsd）。',
 'F-08':'按诊断顺序排查返回零条数据的原因，并提供可解释的用户提示。',
 'F-09':'分别适配各接口的列表、分页和对象结构，区分 content/list、页码/游标及单对象/数组响应，不使用跨接口统一兜底。',
 'F-10':'设计数据模型与数据库表，使用 JSONB 保存数据源专有字段，并按业务主键去重。',
 'F-12':'上线前按目标国家、数据源与关键字段验证实际数据填充率。',
 'U-05':'业务员查看本人数据，主管查看本部门数据，管理员查看全公司数据。通过数据模型层实现行级隔离。',
 'D-03':'免费预估查询结果数量及点数消耗，用户确认后再拉取明细。',
 'D-10':'展示当前账号已开通服务范围内的可用数据源及国家地区覆盖情况。',
 'H-01':'支持地球旋转与国家点击。MVP 可使用静态地图或简化地球。',
 'H-02':'支持国家地区搜索、按大洲分组，输出 ISO Alpha-3 三位国家码。',
 'H-06':'展示已入库企业数、联系人数和贸易记录数。',
 'T-03':'按重量、数量、美元总价、重量单价和数量单价筛选。区间控件强制双值，单边筛选自动补充极大值或极小值。',
 'T-04':'通过可视化条件构造器配置“（A 且 B）或（C 且 D）”及排除条件，并执行后端校验。',
 'T-06':'展开查看贸易术语、发票币种、集装箱号、提单号、船名等贸易明细字段。',
 'T-08':'通过 filterLogisticFields、filterBlankFields 排除物流公司和空公司记录。',
 'T-10':'支持导出 Excel，提供点数消耗提示、权限控制和审计日志。导出能力受腾道合同授权范围约束。',
 'T-11':'展示原产国、目的国汇总与交易趋势图表，支持按月、季度、年度切换。',
 'K-01':'按企业名称查询联系人，查询参数不使用企业 ID。',
 'K-03':'逐条展示联系人实际归属企业，支持仅显示与查询企业名称完全匹配的联系人。',
 'K-05':'同时展示企业邮箱 email、个人邮箱 personalEmail 及其验证状态。',
 'K-06':'展示 LinkedIn、Facebook、Twitter 主页链接，按各项 value 是否为空判断是否有数据，查询不计费。',
 'K-09':'以 mailsouId 为唯一标识去重，不使用恒为 null 的 id 字段。',
 'C-02':'集中展示工商档案、联系方式、贸易统计、联系人、统一互动时间线、WhatsApp 沟通记录及附件。工商档案包含法人、注册资本、成立日期、税号、VAT、运营状态与地址。',
 'C-03':'查询企业详情时必须传入 countryCode3，入库前校验返回国家码与传入值一致。',
 'C-04':'以 data.id 是否为 null 判断企业是否存在，不使用 contactMethods 或 tradeStats 判空。',
 'C-05':'按数据源原始名称存储，仅去除首尾空格与多余标点，不转换大小写或追加句点。',
 'C-06':'展示近一年贸易统计，全零结果不表示企业无贸易。指定时间区间的统计使用进出口商汇总接口。',
 'C-09':'将邮件、通话、备注和 WhatsApp 沟通记录合并为统一时间线，按时间倒序展示。',
 'C-11':'在企业详情页提供 WhatsApp 记录标签页与新增入口。手动登记联系人或号码、我方账号、沟通时间、方向、内容、结果及下次跟进时间，支持增改删。',
 'C-12':'支持向沟通记录或企业档案上传截图、语音转写、报价单及企业资料。允许白名单内图片、文档、压缩包，单文件不超过20MB、单企业不超过50个。服务端校验扩展名及 MIME，并生成存储键。',
 'C-15':'沟通记录与附件继承企业数据权限。WhatsApp 号码加密存储，列表脱敏，详情按权限展开。记录增改删和附件上传、下载均写入审计日志。',
 'M-02':'支持多邮箱轮流发送，包含发送调度及账号健康度管理。',
 'M-05':'基于企业画像生成个性化、多语言开发信。',
 'M-06':'按未送达、已送达、已读、已回复状态配置分支，自动执行差异化多轮跟进。',
 'M-09':'设置单邮箱每日发送上限、发送间隔和发送时段。',
 'M-11':'提供退订链接（List-Unsubscribe）、退订名单全局屏蔽及地区合规开关。退订屏蔽不可绕过。',
 'S-04':'检测发信域名或 IP 的黑名单命中情况及 SPF、DKIM、DMARC 配置，提供修复指引。第三方黑名单或 DNS 数据服务待确认。',
 'A-01':'基于已入库的工商、贸易和联系人数据异步生成结构化企业画像，并缓存分析结果。',
 'A-02':'生成潜客推荐指数，并逐项解释行业关系、采购活跃度、供应商数量等判断依据。',
 'A-06':'展示全网匹配、已挖掘潜客、触达中、已回复四阶段漏斗，以及各阶段相对昨日的增量。',
 'G-02':'将搜索、筛选、背调、找人、验证、起草串联成可配置流程，每一步均支持人工介入。',
 'G-04':'设置单任务点数上限和每日预算，超限时自动暂停并通知。随自动化获客流水线同步提供。',
 'B-03':'所有计费查询在执行前展示预计点数消耗，经用户确认后执行。',
 'B-06':'标注贸易数量预估、企业列表、联系人社媒及扣点流水等免费查询操作。',
 'B-07':'自行统计 API 调用量，按每分钟200次、每日30,000次配额监控并告警。',
 'P-01':'提供深色科技风视觉规范、5组17项左侧分组导航，以及通用表格、高级筛选器、详情抽屉、加载态和空态组件。',
 'P-03':'展示邮箱账号列表，支持连通性测试、发送额度及账号状态查看。',
 'L-01':'按贸易记录、企业、联系人的三步流程关联数据，跨库关联使用企业名称，不使用共同 ID。',
 'W-01':'采集公开渠道 WhatsApp 号码。当前暂缓，数据源待确认，腾道不提供该号码数据。',
 'W-02':'校验 WhatsApp 号码有效性。当前暂缓，具体校验规则待明确。',
 'W-03':'生成 wa.me 链接供人工逐个添加，设置频次上限和冷却时间。当前暂缓，不支持批量自动添加或自动群发。',
 'W-04':'模块启用时强制展示风险提示，用户确认后方可使用。严格地区默认关闭主动添加建议，随本模块上线提供。'
};
const clean = s => s.replace(/\*\*/g,'').replace(/`/g,'').trim();
const md = await fs.readFile(base+'/04-功能清单.md','utf8');
let mod=''; const records=[];
for(const line of md.split(/\r?\n/)) {
 const heading=line.match(/^## .*模块 \d+ · (.+?)（/); if(heading) mod=heading[1];
 if(!/^\| [A-Z]-\d{2} \|/.test(line)) continue;
 const cells=line.split('|').slice(1,-1).map(clean); const [id,name,desc]=cells;
 const [letter,no]=id.split('-');
 const sub=groups[letter]?.[Number(no)-1]; if(!sub) throw Error('Missing group '+id);
 records.push({id,row:[letter==='W'?mod+'（暂缓）':mod,sub,name,descriptions[id]??desc]});
}
if(records.length!==122 || new Set(records.map(r=>r.id)).size!==122) throw Error('Source coverage mismatch');
// Keep each second-level module contiguous while preserving its first appearance.
const order=new Map(); records.forEach(r=>{let k=r.row[0]+'|'+r.row[1];if(!order.has(k))order.set(k,order.size);});
records.sort((a,b)=>order.get(a.row[0]+'|'+a.row[1])-order.get(b.row[0]+'|'+b.row[1]));
const data=[['一级模块名称','二级模块','模块功能','功能描述'],...records.map(r=>r.row)];
const wb=Workbook.create(); const sh=wb.worksheets.add('功能清单');
sh.showGridLines=false;
sh.getRange('A1:D123').values=data;
sh.getRange('A1:D123').format.font={name:'Microsoft YaHei',size:11,color:'#263445'};
sh.getRange('A1:D123').format.wrapText=true;
sh.getRange('A1:D123').format.verticalAlignment='center';
for(const [col,width] of [['A',210],['B',155],['C',270],['D',720]]) sh.getRange(`${col}1:${col}123`).format.columnWidthPx=width;
const table=sh.tables.add('A1:D123',true,'FeatureList'); table.showFilterButton=true;
let prev='',n=-1;
records.forEach((r,i)=>{
 if(r.row[0]!==prev){n++;prev=r.row[0];}
 const range=sh.getRange(`A${i+2}:D${i+2}`);
 range.format.fill=n%2===0?'#FFFFFF':'#F3F6FA';
 const lines=Math.max(...r.row.map((v,j)=>Math.ceil([...v].reduce((s,c)=>s+(c.charCodeAt(0)>255?2:1),0)/[26,19,34,89][j])));
 range.format.rowHeight=Math.max(42,lines*17+12);
});
sh.getRange('A1:D1').format={fill:'#243A53',font:{name:'Microsoft YaHei',size:11,bold:true,color:'#FFFFFF'},rowHeight:32,horizontalAlignment:'center',verticalAlignment:'center'};
sh.freezePanes.freezeRows(1);
wb.recalculate();
console.log((await wb.inspect({kind:'region',sheetId:'功能清单',range:'A1:D4',maxChars:1800,tableMaxCellChars:100})).ndjson);
await (await SpreadsheetFile.exportXlsx(wb)).save(out+'/04-功能清单.xlsx');
await fs.writeFile(out+'/support/data.json',JSON.stringify(data,null,2));
const preview=await wb.render({sheetName:'功能清单',range:'A1:D10',scale:1,format:'png'});
await fs.writeFile(out+'/support/preview.png',new Uint8Array(await preview.arrayBuffer()));
console.log(JSON.stringify({rows:records.length,modules:new Set(records.map(r=>r.row[0])).size,output:out+'/04-功能清单.xlsx'}));
