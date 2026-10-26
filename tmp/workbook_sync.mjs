import fs from 'node:fs/promises';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const root='C:/PXY/ai-research-company';
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(root+'/需求设计/04-功能清单.xlsx'));
const sheet=wb.worksheets.getItemAt(0);
const mode=process.argv[2]||'inspect';
if(mode==='inspect'||mode==='verify'){
 console.log((await wb.inspect({kind:'workbook,sheet,table',maxChars:3500,tableMaxRows:4,tableMaxCols:5})).ndjson);
 const png=await wb.render({sheetName:sheet.name,range:'A1:E8',scale:1.5,format:'png'});
 await fs.writeFile(root+'/tmp/workbook-'+(mode==='verify'?'saved':'before')+'.png',new Uint8Array(await png.arrayBuffer()));
}else{
 const data=JSON.parse(await fs.readFile(root+'/tmp/sync-catalog.json','utf8'));
 // Extend the established five-column view. Preserve sheet name, header, colors and module grouping.
 sheet.getRange('A1:E123').unmerge();
 sheet.getRange('A2:E123').clear({applyTo:'contents'});
 const rows=data.items.map(i=>[data.groups[i.group],i.phase,i.secondary,i.id,i.name,i.description+' 【追溯】'+i.change]);
 sheet.getRange('F1:F123').copyFrom(sheet.getRange('E1:E123'),'all');
 sheet.getRange('E1:E123').copyFrom(sheet.getRange('D1:D123'),'all');
 sheet.getRange('A124:F134').copyFrom(sheet.getRange('A112:F122'),'all');
 sheet.getRange('A1:F1').values=[['一级模块名称','范围','二级模块','功能编号','模块功能','功能描述']];
 sheet.getRange('A2:F'+(rows.length+1)).values=rows;
 sheet.getRange('A2:F134').format.wrapText=true;
 sheet.getRange('A2:F134').format.verticalAlignment='center';
 sheet.getRange('A1:F1').format.rowHeight=30;
 sheet.getRange('A2:F134').format.rowHeight=94;
 sheet.getRange('A1:A134').format.columnWidth=25;
 sheet.getRange('B1:B134').format.columnWidth=14;
 sheet.getRange('C1:C134').format.columnWidth=21;
 sheet.getRange('D1:D134').format.columnWidth=13;
 sheet.getRange('E1:E134').format.columnWidth=35;
 sheet.getRange('F1:F134').format.columnWidth=112;
 for(let idx=0;idx<rows.length;idx++){
  const text=rows[idx][5]; const lines=Math.ceil(text.length/53);
  sheet.getRange(`A${idx+2}:F${idx+2}`).format.rowHeight=Math.max(60,(lines+1)*17);
 }
 let start=2;
 for(const group of Object.keys(data.groups)){
  const count=data.items.filter(i=>i.group===group).length;
  if(count>1)sheet.mergeCells(`A${start}:A${start+count-1}`);
  start+=count;
 }
 sheet.freezePanes.freezeRows(1);
 wb.recalculate();
 console.log((await wb.inspect({kind:'table',range:sheet.name+'!A1:F5',include:'values,formulas',maxChars:3000,tableMaxRows:5,tableMaxCols:6})).ndjson);
 console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:20},maxChars:1000})).ndjson);
 for(const [name,range] of [['first','A1:F7'],['mail','A70:F76'],['last','A125:F134']]){
  const png=await wb.render({sheetName:sheet.name,range,scale:1.25,format:'png'});
  await fs.writeFile(root+'/tmp/workbook-'+name+'.png',new Uint8Array(await png.arrayBuffer()));
 }
 const saved=await SpreadsheetFile.exportXlsx(wb);await saved.save(root+'/需求设计/04-功能清单.xlsx');
 console.log('Saved 133 rows at requested canonical path.');
}
