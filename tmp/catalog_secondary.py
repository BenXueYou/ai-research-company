import json,re
from pathlib import Path
p=Path(__file__).parent
data=json.loads((p/'sync-catalog.json').read_text(encoding='utf-8'))
rows=json.loads((p/'main-workbook.json').read_text(encoding='utf-8'))
secondary={};last=''
for row in rows[1:]:
 cells={re.sub(r'\d','',a):v for a,v in row}
 last=cells.get('C') or last
 secondary[cells.get('D','')]=last
old=(p/'sync-baseline/04-功能清单.md').read_text(encoding='utf-8');idname={}
for line in old.splitlines():
 parts=[v.strip() for v in line.strip('|').split('|')]
 if re.fullmatch(r'[A-Z]-\d{2}',parts[0]):idname[parts[0]]=re.sub(r'\*\*|`|~~','',parts[1])
fallback={'U':'组织与权限','D':'接口与数据','H':'搜索入口','B':'账户与订单','M':'单轮邮件发送','C':'档案维护','K':'联系人获取','P':'角色入口','L':'身份核对','F':'工程与契约'}
for item in data['items']:item['secondary']=secondary.get(idname.get(item['id']),fallback.get(item['group'],'后续能力'))
(p/'sync-catalog.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
