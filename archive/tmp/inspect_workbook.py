from pathlib import Path
import zipfile,xml.etree.ElementTree as E,json,sys
sys.stdout.reconfigure(encoding='utf-8')
n={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
for p in [Path('需求设计/04-功能清单.xlsx'),Path('archive/outputs/01a172a1-7d65-7883-9750-5f655e111a2e/04-功能清单.xlsx')]:
 z=zipfile.ZipFile(p)
 ss=[''.join(t.itertext()) for t in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',n)] if 'xl/sharedStrings.xml' in z.namelist() else []
 print(str(p),E.fromstring(z.read('xl/workbook.xml')).find('s:sheets',n)[0].attrib)
 for x in z.namelist():
  if x.startswith('xl/worksheets/sheet') and x.endswith('.xml'):
   root=E.fromstring(z.read(x)); rows=[]
   for row in root.findall('.//s:row',n):
    out=[]
    for c in row.findall('s:c',n):
     v=c.find('s:v',n); val=(v.text or '') if v is not None else ''.join(c.find('s:is',n).itertext()) if c.find('s:is',n) is not None else ''
     out.append([c.attrib['r'],ss[int(val)] if c.attrib.get('t')=='s' else val])
    rows.append(out)
   print('rows',len(rows),'dimension',root.find('s:dimension',n).attrib if root.find('s:dimension',n) is not None else '', 'merges',len(root.findall('.//s:mergeCell',n)))
   print(json.dumps(rows[:8],ensure_ascii=False))
   Path('archive/tmp/'+('main' if str(p).startswith('需求') else 'historical')+'-workbook.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
