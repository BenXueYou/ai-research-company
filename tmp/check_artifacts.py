from pathlib import Path
import zipfile,xml.etree.ElementTree as E,json,re,collections,sys
sys.stdout.reconfigure(encoding='utf-8')
p=Path(__file__).resolve().parents[1];data=json.loads((p/'tmp/sync-catalog.json').read_text(encoding='utf-8'));n={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
z=zipfile.ZipFile(p/'需求设计/04-功能清单.xlsx');ss=[''.join(t.itertext()) for t in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',n)] if 'xl/sharedStrings.xml' in z.namelist() else []
root=E.fromstring(z.read('xl/worksheets/sheet1.xml'));cells={}
for c in root.findall('.//s:c',n):
 v=c.find('s:v',n);value=v.text if v is not None else ''.join(c.find('s:is',n).itertext()) if c.find('s:is',n) is not None else ''
 cells[c.attrib['r']]=ss[int(value)] if c.attrib.get('t')=='s' else value
errors=[]
for row,item in enumerate(data['items'],2):
 for col,key in [('B','phase'),('C','secondary'),('D','id'),('E','name')]:
  if cells.get(col+str(row))!=item[key]:errors.append([col+str(row),cells.get(col+str(row)),item[key]])
 if cells.get('F'+str(row))!=item['description']+' 【追溯】'+item['change']:errors.append(['description',row])
print('XLSX differences',len(errors),errors[:8]);assert not errors
for file in ['04-功能清单.md','04-功能清单-精简版.md']:
 text=(p/'需求设计'/file).read_text(encoding='utf-8')
 ids=re.findall(r'^\| ([A-Z]-\d{2}) \|',text,re.M)
 assert len(ids)==133 and len(set(ids))==133,(file,len(ids),len(set(ids)))
 for i in data['items']:
  line=next(l for l in text.splitlines() if l.startswith('| '+i['id']+' |'))
  if file=='04-功能清单.md':assert '| '+i['phase']+' |' in line,(file,i['id'],line)
 print(file,'133 unique rows')
prd=(p/'需求设计/02-产品需求文档PRD.md').read_text(encoding='utf-8');review=(p/'需求设计/05-需求复核记录.md').read_text(encoding='utf-8')
titles=re.findall(r'^#{2,3} 已确认：([^\n]+)',review,re.M)
assert len(titles)==69 and all(title in prd for title in titles)
print('PRD 69 confirmed sections covered');print('phase counts',data['counts'])
print('XLSX B6',cells.get('B6'),'D6',cells.get('D6'))
(p/'tmp/content-verification.json').write_text(json.dumps({'catalogCount':133,'counts':data['counts'],'confirmedSections':69,'workbookDifferenceCount':len(errors),'verified':'2026-10-26'},ensure_ascii=False,indent=2),encoding='utf-8')
