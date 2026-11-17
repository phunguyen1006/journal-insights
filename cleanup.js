'use strict';
function cleanEmptySections(raw,{isTemplate=false,mask}={}){
  if(typeof mask!=='function')return {text:raw,quick:0,qa:0};
  const lines=raw.match(/[^\n]*\n|[^\n]+$/g)||[],masked=mask(raw).match(/[^\n]*\n|[^\n]+$/g)||[],remove=new Set();let quick=0,qa=0;
  const line=i=>(lines[i]||'').replace(/\r?\n$/,'');const visible=i=>(masked[i]||'').replace(/\r?\n$/,'');
  const heading=i=>/^\s{0,3}#{1,6}\s+/.test(visible(i));
  const mark=(i)=>{remove.add(i);if(line(i+1).trim()==='---')remove.add(i+1)};
  for(let i=0;i<lines.length;i++){
    if(/^\s{0,3}#{1,6}\s+[^\r\n]*\bQuick Notes\s*#*\s*$/i.test(visible(i))){
      let j=i+1,marker=-1;for(;j<lines.length&&!heading(j);j++){if(/^\s*<p\s+hidden\s*>placer<\/p>\s*$/i.test(line(j))){marker=j;break;}}
      if(marker<0)continue;const before=lines.slice(i+1,marker).map(x=>x.trim()).filter(x=>x&&x!=='---');if(before.length)continue;mark(i);quick++;
    }else if(/^\s{0,3}#{1,6}\s+Q&A\s*#*\s*$/i.test(visible(i))){
      let j=i+1;while(j<lines.length&&!heading(j))j++;let body=lines.slice(i+1,j);
      if(isTemplate){const t=body.findIndex(x=>/^\s*<%\*/.test(x));if(t>=0)body=body.slice(0,t);}
      if(body.some(x=>{const value=x.trim();return value&&value!=='---';}))continue;mark(i);qa++;
    }
  }
  return {text:lines.filter((_,i)=>!remove.has(i)).join(''),quick,qa};
}
async function run(plugin,{mask,Notice,TFile}){
  if(plugin.cleanupRunning)return null;plugin.cleanupRunning=true;
  try{
    const folder=(plugin.settings.dailyFolder||'').replace(/^\/+|\/+$/g,''),vault=plugin.app.vault,files=vault.getMarkdownFiles().filter(f=>folder&&f.path.startsWith(folder+'/'));
    const template=vault.getAbstractFileByPath?.('06 Templates/Parents/Daily.md');if(template instanceof TFile&&!files.some(f=>f.path===template.path))files.push(template);
    const changes=[];for(const file of files){const before=await vault.read(file),isTemplate=file.path==='06 Templates/Parents/Daily.md',plan=cleanEmptySections(before,{isTemplate,mask});if(plan.quick||plan.qa)changes.push({file,before,...plan});}
    if(!changes.length){new Notice('No empty Quick Notes or Q&A sections found.');return {updated:0,quick:0,qa:0,concurrent:0,failed:0};}
    const adapter=vault.adapter,base='.archive',stamp=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,17),dir=base+'/journal-insights-daily-cleanup-'+stamp;
    if(!await adapter.exists(base))await adapter.mkdir(base);if(await adapter.exists(dir))throw new Error('Backup directory already exists.');await adapter.mkdir(dir);
    const backup=JSON.stringify({created:new Date().toISOString(),files:changes.map(x=>({path:x.file.path,text:x.before}))});await adapter.write(dir+'/before.json',backup);if(await adapter.read(dir+'/before.json')!==backup)throw new Error('Backup verification failed.');
    const report={updated:0,quick:0,qa:0,concurrent:0,failed:0,backup:dir+'/before.json'};
    for(let i=0;i<changes.length;i++){const change=changes[i];let updated=false;try{await vault.process(change.file,current=>{if(current!==change.before){report.concurrent++;return current;}updated=true;return change.text;});if(updated){report.updated++;report.quick+=change.quick;report.qa+=change.qa;}}catch(error){report.failed++;}if(i%20===19)await new Promise(resolve=>setTimeout(resolve,10));}
    try{await adapter.write(dir+'/report.json',JSON.stringify(report,null,2));}catch(error){console.error('Journal Insights cleanup report could not be saved',error);}
    new Notice('Cleaned '+report.updated+' files; '+report.concurrent+' changed during cleanup and '+report.failed+' failed. Backup: '+dir,15000);return report;
  }catch(error){console.error('Journal Insights cleanup failed',error);new Notice('Cleanup stopped. Check the console and any existing backup.',12000);return null;}finally{plugin.cleanupRunning=false;}
}
module.exports={cleanEmptySections,run};
