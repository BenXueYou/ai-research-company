from pathlib import Path
import zipfile,xml.etree.ElementTree as E,json,sys
sys.stdout.reconfigure(encoding='utf-8')
n={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
for p in [Path('需求设计/.~04-功能清单（已调整优先级·模块单元格已合并）.xlsx'),Path('需求设计/04-功能清单.xlsx')]:
 z=zipfile.ZipFile(p)
 ss=[''.join(t.itertext()) for t in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',n)] if 'xl/sharedStrings.xml' in z.namelist() else []
 print('\nFILE',p,'sheets',z.read('xl/workbook.xml').decode()[:1600])
 for x in z.namelist():
  if not (x.startswith('xl/worksheets/sheet') and x.endswith('.xml')):continue
  root=E.fromstring(z.read(x));rows=[]
  for row in root.findall('.//s:row',n):
   cells=[]
   for c in row.findall('s:c',n):
    v=c.find('s:v',n);val=(v.text or '') if v is not None else ''.join(c.find('s:is',n).itertext()) if c.find('s:is',n) is not None else ''
    cells.append([c.attrib,ss[int(val)] if c.attrib.get('t')=='s' else val])
   rows.append({'attr':row.attrib,'cells':cells})
  print('sheet',x,'rows',len(rows),'cols',E.tostring(root.find('s:cols',n),encoding='unicode') if root.find('s:cols',n)is not None else '', 'merges',[c.attrib for c in root.findall('.//s:mergeCell',n)])
  print(json.dumps(rows[:5],ensure_ascii=False))
  Path('archive/tmp/'+('reference' if '.~' in p.name else 'current')+'-detail.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
 print('STYLES',z.read('xl/styles.xml').decode()[:14000])
