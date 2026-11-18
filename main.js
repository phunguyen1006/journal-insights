const { Plugin, ItemView, PluginSettingTab, Setting, Notice, TFile, Modal, Platform, editorInfoField, editorLivePreviewField } = require('obsidian');
const photoModule = (()=>{const module={exports:{}};
'use strict';
const IMAGE=/\.(?:png|jpe?g|gif|webp|avif|svg|bmp|heic|heif|tiff?)(?:$|[?#])/i;
const decode=s=>{try{return decodeURIComponent(s)}catch{return s}};
function maskNonContent(raw){
  const lines=raw.match(/[^\n]*\n|[^\n]+$/g)||[],out=[];let fm=false,fence=null,comment=false,template=false;
  for(let i=0;i<lines.length;i++){
    const line=lines[i],trim=line.trim();let hidden=false;
    if(i===0&&trim.replace(/^\uFEFF/,'')==='---'){fm=true;hidden=true;}else if(fm){hidden=true;if(trim==='---'||trim==='...')fm=false;}
    else if(fence){hidden=true;if(new RegExp('^\\s*'+fence[0]+'{'+fence.length+',}\\s*$').test(trim))fence=null;}
    else {const m=line.match(/^\s{0,3}(`{3,}|~{3,})/);if(m){fence=m[1];hidden=true;}}
    let chars=line.split('');if(hidden)chars=chars.map(c=>c==='\n'||c==='\r'?c:' ');
    else for(let j=0;j<chars.length;j++){
      const pair=chars[j]+(chars[j+1]||'');
      if(!comment&&!template&&pair==='%%'){comment=true;chars[j]=' ';chars[j+1]=' ';j++;continue;}
      if(comment&&pair==='%%'){comment=false;chars[j]=' ';chars[j+1]=' ';j++;continue;}
      if(!comment&&!template&&pair==='<%'){template=true;chars[j]=' ';chars[j+1]=' ';j++;continue;}
      if(template&&pair==='%>'){template=false;chars[j]=' ';chars[j+1]=' ';j++;continue;}
      if((comment||template)&&chars[j]!=='\n'&&chars[j]!=='\r')chars[j]=' ';
    }
    out.push(chars.join(''));
  }
  return out.join('').replace(/<!--[^]*?-->/g,m=>m.replace(/[^\r\n]/g,' ')).replace(/(`+)([^\n]*?)\1/g,m=>m.replace(/[^\r\n]/g,' '));
}
function photoKind(target,isMarkdown){
  if(/^dayone-moment:/i.test(target))return 'dayone';
  if(/^https?:\/\//i.test(target))return isMarkdown?'remote':null;
  if(/^[a-z][a-z0-9+.-]*:/i.test(target)||/^\/\//.test(target))return null;
  return IMAGE.test(target)?'local':null;
}
function parsePhotos(raw){
  const visible=maskNonContent(raw),items=[];let i=0;
  while(i<visible.length){
    const start=visible.indexOf('![',i);if(start<0)break;
    if(visible[start-1]==='\\'){i=start+2;continue;}
    if(visible[start+2]==='['){
      const end=visible.indexOf(']]',start+3);if(end<0||visible.slice(start,end).includes('\n')){i=start+3;continue;}
      const inner=visible.slice(start+3,end),target=inner.split('|')[0].split('#')[0].trim(),kind=photoKind(target,false);
      if(kind)items.push({start,end:end+2,target:decode(target),kind,alt:''});i=end+2;continue;
    }
    const bracket=visible.indexOf('](',start+2);if(bracket<0||visible.slice(start,bracket).includes('\n')){i=start+2;continue;}
    let j=bracket+2,depth=1,escaped=false;
    while(j<visible.length&&visible[j]!=='\n'&&depth){const c=visible[j];if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='(')depth++;else if(c===')')depth--;j++;}
    if(depth){i=bracket+2;continue;}
    const body=visible.slice(bracket+2,j-1).trim(),target=(body.startsWith('<')&&body.includes('>')?body.slice(1,body.indexOf('>')):body.split(/\s+/)[0]).trim();
    const kind=photoKind(target,true);if(kind)items.push({start,end:j,target:kind==='local'?decode(target):target,kind,alt:visible.slice(start+2,bracket)});i=j;
  }
  return items;
}
function pictureGroups(raw){
  const masked=maskNonContent(raw),items=parsePhotos(raw),lines=[];let offset=0;
  for(const line of masked.split('\n')){lines.push({start:offset,end:offset+line.length,text:line.replace(/\r$/,'')});offset+=line.length+1;}
  const groups=[];let inside=false,level=0,run=[];
  const flush=()=>{if(run.length){groups.push({from:lines[run[0].line].start,to:lines[run[run.length-1].line].end,startLine:run[0].line,endLine:run[run.length-1].line,photos:run.map(x=>x.photo)});run=[];}};
  lines.forEach((line,index)=>{
    const heading=line.text.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if(heading){
      if(/PicturesEnd/i.test(heading[2])){flush();inside=false;return;}
      if(/^[^\p{L}\p{N}]*Pictures\s*#*\s*$/iu.test(heading[2])){flush();inside=true;level=heading[1].length;return;}
      if(inside&&heading[1].length<=level){flush();inside=false;return;}
    }
    if(!inside)return;
    const onLine=items.filter(p=>p.start>=line.start&&p.end<=line.end);
    if(onLine.length===1&&masked.slice(line.start,onLine[0].start).trim()===''&&masked.slice(onLine[0].end,line.end).trim()===''){run.push({line:index,photo:onLine[0]});return;}
    if(line.text.trim()!=='')flush();
  });flush();return groups;
}
function resolvePhoto(app,photo,sourcePath,TFile){
  if(photo.kind==='dayone')return {kind:'dayone',photo};
  if(photo.kind==='remote')return {kind:'remote',photo};
  let file=null;try{file=app.metadataCache.getFirstLinkpathDest(photo.target,sourcePath)}catch{}
  if(!(file instanceof TFile))return {kind:'missing',photo};
  return {kind:'local',photo,file,src:app.vault.getResourcePath(file)};
}
function makeController(plugin,{Modal,TFile,el,button}){
  function viewer(photos,sourcePath,index=0){
    if(!Modal||!photos.length)return;
    const modal=new Modal(plugin.app);let current=Math.max(0,Math.min(index,photos.length-1)),allowRemote=new Set();
    modal.onOpen=()=>{
      const root=modal.contentEl;root.classList.add('ji-photo-viewer');root.setAttribute('tabindex','-1');
      root.empty();const nav=el(root,'div','ji-photo-viewer-nav');
      button(nav,'Previous',()=>{current=(current-1+photos.length)%photos.length;draw()},'ji-button');
      const count=el(nav,'span','ji-photo-count');count.setAttribute('aria-live','polite');
      button(nav,'Next',()=>{current=(current+1)%photos.length;draw()},'ji-button');
      const stage=el(root,'div','ji-photo-viewer-stage');
      const close=button(root,'Close',()=>modal.close(),'ji-button ji-photo-close');close.setAttribute('aria-label','Close photo viewer');
      const draw=()=>{
        count.textContent=(current+1)+' / '+photos.length;stage.empty();const result=resolvePhoto(plugin.app,photos[current],sourcePath,TFile);
        if(result.kind==='local'||(result.kind==='remote'&&allowRemote.has(current))){const img=el(stage,'img','ji-photo-full');img.alt=photos[current].alt||'Journal photo '+(current+1);img.addEventListener('error',()=>{if(!stage.contains(img))return;img.remove();el(stage,'p','ji-photo-unavailable','Image could not be loaded.');});img.src=result.kind==='local'?result.src:photos[current].target;}
        else if(result.kind==='remote'){let host='';try{host=new URL(photos[current].target).hostname}catch{}el(stage,'p','ji-photo-unavailable','External image'+(host?' · '+host:''));button(stage,'Load image',()=>{allowRemote.add(current);draw();root.focus()},'ji-button');}
        else {
          el(stage,'p','ji-photo-unavailable',result.kind==='dayone'?'Day One media unavailable':'Image file not found');
          const note=plugin.app.vault.getAbstractFileByPath?.(sourcePath);
          if(note instanceof TFile)button(stage,'Open note',()=>{modal.close();plugin.app.workspace.getLeaf('tab').openFile(note)},'ji-button');
        }
      };draw();
      root.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'){event.preventDefault();current=(current-1+photos.length)%photos.length;draw()}if(event.key==='ArrowRight'){event.preventDefault();current=(current+1)%photos.length;draw()}});
      root.focus();
    };
    modal.open();
  }
  function gallery(root,photos,sourcePath,{limit=3,className='',onOpen,label}={}){
    if(!photos||!photos.length)return null;
    const shown=Math.min(limit,photos.length),strip=el(root,'div','ji-photos '+className);strip.setAttribute('aria-label','Journal photos');
    for(let i=0;i<shown;i++){
      const item=resolvePhoto(plugin.app,photos[i],sourcePath,TFile),slot=el(strip,'div','ji-photo-slot'),b=button(slot,'',()=>onOpen?onOpen(i):viewer(photos,sourcePath,i),'ji-photo-tile');
      b.setAttribute('aria-label',label||'Open photo '+(i+1)+' of '+photos.length+(item.kind==='missing'?' (file missing)':item.kind==='remote'?' (external)':item.kind==='dayone'?' (Day One media)':''));
      if(item.kind==='local'){
        const img=el(b,'img','ji-photo-thumb');img.alt='';img.loading='lazy';img.decoding='async';img.src=item.src;img.addEventListener('error',()=>{img.remove();el(b,'span','ji-photo-placeholder','Image unavailable');});
      }else el(b,'span','ji-photo-placeholder',item.kind==='remote'?'External image':item.kind==='dayone'?'Day One media':'Image not found');
      if(i===shown-1&&photos.length>shown){const extra=button(slot,'+'+(photos.length-shown),()=>viewer(photos,sourcePath,shown),'ji-photo-more');extra.setAttribute('aria-label','View '+(photos.length-shown)+' more photos');}
    }
    return strip;
  }
  return {viewer,gallery};
}
module.exports={maskNonContent,parsePhotos,pictureGroups,resolvePhoto,makeController};

return module.exports;})();
const galleryModule = (()=>{const module={exports:{}};
'use strict';
function registerNoteGalleries(plugin,{photos,TFile,editorInfoField,editorLivePreviewField,Notice}){
  const inDaily=path=>typeof path==='string'&&path.startsWith((plugin.settings.dailyFolder||'').replace(/\/+$/,'')+'/');
  const enabled=()=>plugin.settings.experience?.photoGalleryInNotes!==false;
  if(typeof plugin.registerMarkdownPostProcessor==='function'){
    // A blank line can make Obsidian render one image run as several sections.
    // Wait until every part of the run is present before replacing any section.
    const readingRuns=new WeakMap();
    plugin.registerMarkdownPostProcessor(async (root,ctx)=>{
      if(!enabled()||!inDaily(ctx.sourcePath)||typeof ctx.getSectionInfo!=='function')return;
      const info=ctx.getSectionInfo(root);if(!info)return;
      const file=plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);if(!(file instanceof TFile))return;
      const raw=await plugin.app.vault.cachedRead(file);if(!root.isConnected||!enabled())return;
      const lines=raw.split('\n'),offsets=[0];for(const line of lines)offsets.push(offsets[offsets.length-1]+line.length+1);
      const section=lines.slice(info.lineStart,info.lineEnd+1).join('\n'),sectionPhotos=photos.parsePhotos(section);
      const remainder=sectionPhotos.reduceRight((s,p)=>s.slice(0,p.start)+s.slice(p.end),section);
      // Never replace a block that also contains a heading, caption, or other text.
      if(remainder.trim()||!sectionPhotos.length)return;
      const starts=sectionPhotos.map(p=>p.start+offsets[info.lineStart]);
      const groups=photos.pictureGroups(raw).filter(g=>starts.every(start=>g.photos.some(p=>p.start===start)));
      if(groups.length!==1)return;const group=groups[0];
      const existing=root.querySelectorAll('.internal-embed, img, .external-link');if(!existing.length)return;
      const container=root.closest('.markdown-preview-view')||root.parentElement;if(!container)return;
      let runs=readingRuns.get(container);if(!runs){runs=new Map();readingRuns.set(container,runs)}
      const key=ctx.sourcePath+'\0'+group.from+'\0'+group.to+'\0'+JSON.stringify(group.photos.map(p=>p.target));
      let parts=runs.get(key)||[];parts=parts.filter(p=>p.root.isConnected&&p.root!==root);parts.push({root,starts,line:info.lineStart});runs.set(key,parts);
      const covered=new Set(parts.flatMap(p=>p.starts));
      if(covered.size!==group.photos.length||parts.reduce((n,p)=>n+p.starts.length,0)!==group.photos.length||!group.photos.every(p=>covered.has(p.start)))return;
      parts.sort((a,b)=>a.line-b.line);const first=parts[0].root;
      for(const part of parts){part.root.replaceChildren();if(part.root!==first)part.root.classList.add('ji-empty-photo-section');}
      plugin.photoController.gallery(first,group.photos,ctx.sourcePath,{limit:3,className:'ji-note-gallery'});
    });
  }
  if(typeof plugin.registerEditorExtension!=='function'||!editorInfoField||!editorLivePreviewField)return;
  let StateField,Decoration,EditorView,WidgetType;
  try{({StateField}=require('@codemirror/state'));({Decoration,EditorView,WidgetType}=require('@codemirror/view'));}
  catch(error){console.error('Journal Insights note gallery unavailable',error);new Notice('Photo gallery in Live Preview is unavailable.');return;}
  class GalleryWidget extends WidgetType{
    constructor(group,path){super();this.group=group;this.path=path;}
    eq(other){return this.path===other.path&&this.group.from===other.group.from&&this.group.to===other.group.to&&JSON.stringify(this.group.photos)===JSON.stringify(other.group.photos);}
    toDOM(view){
      const wrap=document.createElement('div');wrap.className='ji-editor-gallery';
      plugin.photoController.gallery(wrap,this.group.photos,this.path,{limit:3,className:'ji-note-gallery'});
      const edit=document.createElement('button');edit.type='button';edit.className='ji-note-edit';edit.textContent='Edit images';
      edit.addEventListener('click',event=>{event.preventDefault();view.dispatch({selection:{anchor:this.group.from},scrollIntoView:true});view.focus();});wrap.appendChild(edit);return wrap;
    }
    ignoreEvent(){return true;}
  }
  const build=state=>{
    const info=state.field(editorInfoField,false),live=state.field(editorLivePreviewField,false);
    const path=info?.file?.path;if(!live||!inDaily(path))return Decoration.none;
    const groups=photos.pictureGroups(state.doc.toString()),ranges=[];
    for(const group of groups){
      const selected=state.selection.ranges.some(r=>r.from<=group.to&&r.to>=group.from);
      if(!selected)ranges.push(Decoration.replace({block:true,widget:new GalleryWidget(group,path)}).range(group.from,group.to));
    }
    return Decoration.set(ranges,true);
  };
  const field=StateField.define({create:build,update(value,tr){return tr.docChanged||tr.selection?build(tr.state):value;},provide:f=>EditorView.decorations.from(f)});
  plugin.photoEditorExtension=[];
  if(enabled())plugin.photoEditorExtension.push(field);
  plugin.registerEditorExtension(plugin.photoEditorExtension);
  plugin.updatePhotoEditor=()=>{plugin.photoEditorExtension.length=0;if(enabled())plugin.photoEditorExtension.push(field);plugin.app.workspace.updateOptions();};
}
module.exports={registerNoteGalleries};

return module.exports;})();
const metricsModule = (()=>{const module={exports:{}};
'use strict';
const DAY=86400000;
const CATEGORIES=[
  {key:'spiritual',label:'Spiritual'}, {key:'career',label:'Career'},
  {key:'relationships',label:'Relationships'}, {key:'health',label:'Health'},
  {key:'growth',label:'Growth'}, {key:'recreation',label:'Recreation'},
  {key:'social',label:'Social'}, {key:'finance',label:'Finance'}
];
function dayNumber(key){const n=Date.parse(String(key)+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===key?Math.floor(n/DAY):null;}
function dayKey(n){return new Date(n*DAY).toISOString().slice(0,10)}
function shift(key,n){const d=dayNumber(key);return d===null?null:dayKey(d+n)}
function score(value){
  if(typeof value!=='number'&&typeof value!=='string')return null;
  if(typeof value==='string'&&!/^\s*(?:\d+(?:\.\d+)?)\s*$/.test(value))return null;
  const n=Number(value);return Number.isFinite(n)&&n>=1&&n<=10?n:null;
}
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
function ratings(rows,range,today){
  const groups=new Map();for(const row of rows){if(!row.date||dayNumber(row.date)===null||row.date>today||row.date<range.start||row.date>range.end)continue;const s=score(row.rating);if(s===null)continue;if(!groups.has(row.date))groups.set(row.date,{date:row.date,values:new Set(),records:[]});const g=groups.get(row.date);g.values.add(s);g.records.push(row);}
  const data=[],conflicts=[];for(const g of groups.values()){if(g.values.size===1)data.push({date:g.date,value:[...g.values][0],records:g.records});else conflicts.push({date:g.date,records:g.records});}
  data.sort((a,b)=>a.date.localeCompare(b.date));conflicts.sort((a,b)=>a.date.localeCompare(b.date));
  const buckets=new Map(),fractional=data.some(x=>!Number.isInteger(x.value)),distribution=Array.from({length:10},(_,i)=>({label:fractional&&i<9?String(i+1)+'–<'+String(i+2):String(i+1),value:0,dates:[]}));
  for(const x of data){const month=x.date.slice(0,7);if(!buckets.has(month))buckets.set(month,{label:month,values:[],dates:[]});let b=buckets.get(month);b.values.push(x.value);b.dates.push(x.date);const index=Math.min(9,Math.floor(x.value)-1);distribution[index].value++;distribution[index].dates.push(x.date);}
  return {data,conflicts,average:mean(data.map(x=>x.value)),monthly:[...buckets.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(b=>({label:b.label,value:mean(b.values),dates:b.dates,sample:b.values.length})),distribution};
}
function isoWeekStart(name){
  const m=String(name||'').match(/^(\d{4})-W(\d{2})(?=$|\D)/i);if(!m)return null;
  const year=Number(m[1]),week=Number(m[2]);if(week<1||week>53)return null;
  const jan4=Math.floor(Date.UTC(year,0,4)/DAY),offset=(new Date(jan4*DAY).getUTCDay()+6)%7,start=jan4-offset+7*(week-1);
  if(new Date((start+3)*DAY).getUTCFullYear()!==year)return null;
  return {start:dayKey(start),end:dayKey(start+6),label:String(year)+'-W'+String(week).padStart(2,'0')};
}
function weekly(rows){
  const groups=new Map();for(const row of rows){const w=isoWeekStart(row.file?.basename);if(!w)continue;if(!groups.has(w.start))groups.set(w.start,{...w,records:[],values:Object.fromEntries(CATEGORIES.map(c=>[c.key,new Set()]))});const g=groups.get(w.start);g.records.push(row);const data=row.wheel&&typeof row.wheel==='object'&&!Array.isArray(row.wheel)?row.wheel:{};for(const c of CATEGORIES){const v=score(data[c.key]);if(v!==null)g.values[c.key].add(v);}}
  return [...groups.values()].sort((a,b)=>a.start.localeCompare(b.start)).map(g=>{let conflicts=0;const values={};for(const c of CATEGORIES){const set=g.values[c.key];if(set.size===1)values[c.key]=[...set][0];else{values[c.key]=null;if(set.size>1)conflicts++;}}return {start:g.start,end:g.end,label:g.label,records:g.records,values,conflicts};});
}
function selectedWeeks(weeks,range,today){return weeks.filter(w=>{if(w.start>today)return false;const anchor=shift(w.start,3),inRange=anchor>=range.start&&anchor<=range.end,ongoing=range.end===today&&w.start<=today&&w.end>=today&&anchor>today&&w.start<=range.end&&w.end>=range.start;return inRange||ongoing;});}
function wheelSummary(weeks){return CATEGORIES.map(c=>{const values=weeks.map(w=>w.values[c.key]).filter(v=>v!==null);return {...c,value:mean(values),count:values.length};});}
function bucketFor(w,period){const anchor=shift(w.start,3),year=anchor.slice(0,4),month=Number(anchor.slice(5,7));if(period==='weekly')return {label:w.label,start:w.start};if(period==='quarterly')return {label:year+'-Q'+Math.ceil(month/3),start:year+'-'+String(Math.floor((month-1)/3)*3+1).padStart(2,'0')+'-01'};if(period==='yearly')return {label:year,start:year+'-01-01'};return {label:anchor.slice(0,7),start:anchor.slice(0,7)+'-01'};}
function wheelTimeline(weeks,period,category){
  const groups=new Map();for(const w of weeks){const b=bucketFor(w,period);if(!groups.has(b.label))groups.set(b.label,{...b,values:[],weeks:[]});const g=groups.get(b.label),v=w.values[category];if(v!==null){g.values.push(v);g.weeks.push(w);}}
  return [...groups.values()].sort((a,b)=>a.start.localeCompare(b.start)).map(g=>({label:g.label,start:g.start,value:mean(g.values),count:g.values.length,weeks:g.weeks}));
}
function hasJournal(day){return !!day&&(day.words>0||(day.records||[]).some(e=>Array.isArray(e.photos)&&e.photos.length>0));}
function journalStreak(days,today){
  const valid=[...days.values()].filter(d=>d.date&&d.date<=today&&hasJournal(d)).sort((a,b)=>a.date.localeCompare(b.date));let longest=0,run=0,last=null;
  for(const d of valid){run=last&&shift(d.date,-1)===last?run+1:1;longest=Math.max(longest,run);last=d.date;}
  let cursor=today;if(!hasJournal(days.get(cursor)))cursor=shift(cursor,-1);let current=0,photoOnly=0;
  while(hasJournal(days.get(cursor))){if(!(days.get(cursor).words>0))photoOnly++;current++;cursor=shift(cursor,-1);}
  return {current,longest,photoOnly,breakDate:cursor,breakHasNote:days.has(cursor)};
}
module.exports={CATEGORIES,dayNumber,dayKey,shift,score,ratings,isoWeekStart,weekly,selectedWeeks,wheelSummary,bucketFor,wheelTimeline,hasJournal,journalStreak};

return module.exports;})();
const cleanupModule = (()=>{const module={exports:{}};
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

return module.exports;})();
const indexModule = (()=>{const module={exports:{}};
'use strict';

// One index serves all dashboard views. A batch of vault and metadata events
// only queues each changed path once, even when brought in by sync.
class JournalIndex {
  constructor({ list, classify, load }) {
    this.list = list;
    this.classify = classify;
    this.load = load;
    this.rows = new Map();
    this.errors = new Set();
    this.pending = new Map();
    this.requestScan();
  }

  requestScan(force = false) {
    this.needsScan = true;
    this.forceScan = this.forceScan || force;
  }

  invalidate(file, data, metadata) {
    if (!this.classify(file.path)) return false;
    const queued = this.pending.get(file.path);
    const stamp = file.stat?.mtime;
    if (!(data === undefined && queued?.data !== undefined && queued.file === file && queued.stamp === stamp)) {
      this.pending.set(file.path, { file, data, metadata, stamp });
    }
    return true;
  }

  forget(path) {
    if (!this.classify(path) && !this.rows.has(path) && !this.pending.has(path)) return false;
    this.pending.set(path, null);
    return true;
  }

  update() {
    if (!this.running) {
      this.running = this.drain().finally(() => { this.running = null; });
    }
    return this.running;
  }

  reconcile() {
    const force = this.forceScan;
    this.needsScan = this.forceScan = false;
    const paths = new Set();
    for (const file of this.list()) {
      const kind = this.classify(file.path);
      if (!kind) continue;
      paths.add(file.path);
      const previous = this.rows.get(file.path);
      if (!this.pending.get(file.path) &&
          (force || !previous || previous.file !== file || previous.kind !== kind ||
           previous.stamp !== file.stat?.mtime)) {
        this.invalidate(file);
      }
    }
    for (const path of [...this.rows.keys(), ...this.errors, ...this.pending.keys()]) {
      if (!paths.has(path)) this.pending.set(path, null);
    }
  }

  async drain() {
    do {
      if (this.needsScan) this.reconcile();
      const jobs = [...this.pending];
      this.pending.clear();
      let cursor = 0;
      const worker = async () => {
        while (cursor < jobs.length) {
          const [path, change] = jobs[cursor++];
          const kind = change && this.classify(path);
          if (!kind || change.file.path !== path) {
            this.rows.delete(path);
            this.errors.delete(path);
            continue;
          }
          const { file, data, metadata, stamp } = change;
          try {
            const row = await this.load(file, kind, data, metadata);
            if (!this.pending.has(path) && file.path === path) {
              this.rows.set(path, { ...row, file, kind, stamp });
              this.errors.delete(path);
            }
          } catch {
            if (!this.pending.has(path)) {
              this.rows.delete(path);
              this.errors.add(path);
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, worker));
    } while (this.needsScan || this.pending.size);

    const entries = [], weekEntries = [], periods = [];
    for (const row of this.rows.values()) {
      if (row.kind === 'daily') entries.push(row);
      else {
        if (row.kind === 'weekly') weekEntries.push(row);
        if (row.period) periods.push(row);
      }
    }
    entries.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.file.path.localeCompare(b.file.path));
    periods.sort((a, b) => a.period.start.localeCompare(b.period.start) || a.file.path.localeCompare(b.file.path));
    return { entries, weekEntries, periods, failed: this.errors.size };
  }
}

module.exports = { JournalIndex };

return module.exports;})();
const searchModule = (()=>{const module={exports:{}};
'use strict';

const ENTRY_PAGE = 36;
const PHOTO_PAGE = 36;

function fold(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd');
}

function queryText(value) {
  return fold(value).trim().replace(/\s+/g, ' ');
}

function searchEntry(entry, filters) {
  const { query, year, start, end, photos, rating } = filters;
  const date = entry.date;
  if (year && year !== 'all' && !date?.startsWith(year + '-')) return false;
  if ((start && (!date || date < start)) || (end && (!date || date > end))) return false;
  if (photos && !entry.photos?.length) return false;
  const score = entry.rating ?? null;
  if (rating === 'rated' && score === null) return false;
  if (rating === 'unrated' && score !== null) return false;
  if (rating?.startsWith('min-') && (score === null || score < Number(rating.slice(4)))) return false;
  return !query || (entry.searchText ?? fold(entry.text)).includes(query) ||
    fold(entry.file.basename).includes(query) || Boolean(date?.includes(query));
}

function excerpt(text, query, length = 220) {
  if (!text) return { before: '', match: '', after: '' };
  if (!query) return {
    before: text.slice(0, length) + (text.length > length ? '…' : ''),
    match: '', after: ''
  };

  // Build offsets in the original spelling so precomposed Vietnamese and
  // decomposed combining marks are highlighted without altering the preview.
  let folded = '', offset = 0;
  const positions = [];
  for (const symbol of text) {
    const next = offset + symbol.length;
    const part = fold(symbol);
    folded += part;
    if (!part && positions.length) positions[positions.length - 1].end = next;
    for (let i = 0; i < part.length; i++) positions.push({ start: offset, end: next });
    offset = next;
  }
  const hit = folded.indexOf(query);
  if (hit < 0) return excerpt(text, '', length);
  const start = positions[hit].start, end = positions[hit + query.length - 1].end;
  const from = Math.max(0, start - Math.floor(length / 4));
  const through = Math.min(text.length, Math.max(end, from + length));
  return {
    before: (from ? '…' : '') + text.slice(from, start),
    match: text.slice(start, end),
    after: text.slice(end, through) + (through < text.length ? '…' : '')
  };
}

function photoTimeline(entries, eligible) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.date || !entry.photos?.length || !eligible(entry)) continue;
    const month = entry.date.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    for (const photo of entry.photos) groups.get(month).push({ entry, photo });
  }
  return groups;
}

function install(JournalView, { el, button, formatNumber, formatDate, localKey, memoryEligible }) {
  const tabTitle = (view, root, mode) => {
    const title = view.title(root, '', 'Entries');
    const switcher = el(title, 'div', 'ji-mode-switch');
    switcher.setAttribute('aria-label', 'Entries view');
    for (const [id, label] of [['entries', 'Entries'], ['photos', 'Photo Timeline']]) {
      const control = button(switcher, label, () => {
        view.entriesMode = id;
        view.clearScroll('entries');
        view.render();
        view.contentEl.querySelector?.('[data-ji-focus="entries-mode-' + id + '"]')?.focus({ preventScroll: true });
      }, 'ji-mode-button');
      control.setAttribute('aria-pressed', String(mode === id));
      control.setAttribute('data-ji-focus', 'entries-mode-' + id);
    }
  };

  JournalView.prototype.renderEntries = function(root, entries) {
    const mode = this.entriesMode || 'entries';
    tabTitle(this, root, mode);
    if (mode === 'photos') {
      this.renderPhotoTimeline(root, entries);
      return;
    }

    const toolbar = el(root, 'div', 'ji-entry-tools');
    const search = el(toolbar, 'input', 'ji-input');
    search.type = 'search';
    search.placeholder = 'Search entries…';
    search.value = this.query;
    search.setAttribute('aria-label', 'Search entries');
    search.setAttribute('data-ji-focus', 'entry-search');

    const years = ['all', ...[...new Set(entries.flatMap(entry => entry.date ? [entry.date.slice(0, 4)] : []))].sort().reverse()];
    if (!years.includes(this.entryYear)) this.entryYear = 'all';
    const year = el(toolbar, 'select', 'ji-select');
    year.setAttribute('aria-label', 'Filter entries by year');
    year.setAttribute('data-ji-focus', 'entry-year');
    for (const value of years) el(year, 'option', '', value === 'all' ? 'All years' : value).value = value;
    year.value = this.entryYear;

    const filters = this.entryFilters || (this.entryFilters = {});
    const advanced = el(root, 'details', 'ji-entry-filters');
    advanced.open = this.entryFiltersOpen ?? Boolean(filters.start || filters.end || filters.photos || filters.rating);
    el(advanced, 'summary', '', 'Filters');
    advanced.addEventListener('toggle', () => {
      if (advanced.isConnected) this.entryFiltersOpen = advanced.open;
    });
    const fields = el(advanced, 'div', 'ji-filter-fields');
    const dates = {};
    for (const [key, label] of [['start', 'From'], ['end', 'Through']]) {
      const lab = el(fields, 'label', 'ji-date-label');
      el(lab, 'span', '', label);
      const input = el(lab, 'input', 'ji-input');
      input.type = 'date';
      input.value = filters[key] || '';
      input.setAttribute('data-ji-focus', 'entry-' + key);
      dates[key] = input;
    }

    const ratingLabel = el(fields, 'label', 'ji-date-label');
    el(ratingLabel, 'span', '', 'Rating');
    const rating = el(ratingLabel, 'select', 'ji-select');
    rating.setAttribute('data-ji-focus', 'entry-rating');
    for (const [value, label] of [['', 'Any rating'], ['rated', 'Rated'], ['unrated', 'Unrated']]) {
      el(rating, 'option', '', label).value = value;
    }
    for (let min = 2; min <= 10; min++) el(rating, 'option', '', min + ' or higher').value = 'min-' + min;
    rating.value = filters.rating || '';

    const photoLabel = el(fields, 'label', 'ji-toggle-label ji-filter-photos');
    const photos = el(photoLabel, 'input');
    photos.type = 'checkbox';
    photos.checked = Boolean(filters.photos);
    photos.setAttribute('data-ji-focus', 'entry-photos');
    el(photoLabel, 'span', '', 'Has photos');

    const results = el(root, 'div', 'ji-results');
    const status = el(results, 'p', 'ji-result-count');
    status.setAttribute('role', 'status');
    const list = el(results, 'div', 'ji-filter-list');
    const draw = () => {
      list.empty();
      if (filters.start && filters.end && filters.start > filters.end) {
        status.textContent = 'Choose an end date on or after the start date.';
        return;
      }
      const query = queryText(this.query);
      const found = entries.filter(entry => searchEntry(entry, { ...filters, query, year: this.entryYear }));
      status.textContent = formatNumber(found.length) + (found.length === 1 ? ' entry' : ' entries');
      this.cards(list, found.slice(0, this.limit), false, { query });
      if (found.length > this.limit) {
        button(list, 'Load more', () => {
          this.limit += ENTRY_PAGE;
          draw();
          list.querySelector?.('.ji-card-item:nth-child(' + (this.limit - ENTRY_PAGE + 1) + ') .ji-card')?.focus();
        }, 'ji-button ji-more');
      }
    };
    const resetPage = () => { this.limit = ENTRY_PAGE; draw(); };
    search.addEventListener('input', () => { this.query = search.value; resetPage(); });
    year.addEventListener('change', () => { this.entryYear = year.value; resetPage(); });
    dates.start.addEventListener('change', () => { filters.start = dates.start.value; resetPage(); });
    dates.end.addEventListener('change', () => { filters.end = dates.end.value; resetPage(); });
    rating.addEventListener('change', () => { filters.rating = rating.value; resetPage(); });
    photos.addEventListener('change', () => { filters.photos = photos.checked; resetPage(); });
    button(fields, 'Clear filters', () => {
      this.query = search.value = '';
      this.entryYear = year.value = 'all';
      dates.start.value = dates.end.value = rating.value = '';
      photos.checked = false;
      Object.assign(filters, { start: '', end: '', rating: '', photos: false });
      resetPage();
    }, 'ji-button ji-quiet');
    draw();
  };

  JournalView.prototype.renderPhotoTimeline = function(root, entries) {
    if (this.prefs().showPhotoPreviews === false) {
      el(root, 'p', 'ji-empty', 'Photo previews are turned off.');
      button(root, 'Picture settings', () => this.navigate('settings'), 'ji-button');
      return;
    }
    const today = localKey(new Date()), { excluded } = this.prefs();
    const groups = photoTimeline(entries, entry => entry.date <= today && memoryEligible(entry, excluded));
    const months = [...groups.keys()].sort().reverse();
    if (!months.length) {
      el(root, 'p', 'ji-empty', 'No journal photos to show yet.');
      return;
    }

    const label = el(root, 'label', 'ji-date-label ji-photo-month-label');
    el(label, 'span', '', 'Month');
    const selector = el(label, 'select', 'ji-select');
    selector.setAttribute('data-ji-focus', 'photo-month');
    el(selector, 'option', '', 'All months').value = 'all';
    const monthLabel = month => formatDate(month + '-01', { month: 'long', year: 'numeric' });
    for (const month of months) el(selector, 'option', '', monthLabel(month)).value = month;
    if (!this.photoMonth || (this.photoMonth !== 'all' && !months.includes(this.photoMonth))) this.photoMonth = 'all';
    selector.value = this.photoMonth;
    selector.addEventListener('change', () => {
      this.photoMonth = selector.value;
      this.photoLimit = PHOTO_PAGE;
      this.clearScroll('entries');
      this.render();
    });

    const shownMonths = this.photoMonth === 'all' ? months : [this.photoMonth];
    let remaining = this.photoLimit || PHOTO_PAGE;
    for (const month of shownMonths) {
      if (remaining <= 0) break;
      const section = el(root, 'section', 'ji-timeline-month');
      this.title(section, '', monthLabel(month));
      const grid = el(section, 'div', 'ji-timeline-grid');
      for (const { entry, photo } of groups.get(month).slice(0, remaining)) {
        const item = el(grid, 'article', 'ji-timeline-item');
        const dateLabel = formatDate(entry.date, { month: 'short', day: 'numeric' });
        this.plugin.photoController.gallery(item, [photo], entry.file.path, {
          limit: 1, className: 'ji-timeline-photo', onOpen: () => this.openEntry(entry),
          label: 'Open journal entry for ' + entry.date
        });
        el(item, 'span', 'ji-timeline-date', dateLabel);
        remaining--;
      }
    }
    const total = shownMonths.reduce((sum, month) => sum + groups.get(month).length, 0);
    if (total > (this.photoLimit || PHOTO_PAGE)) {
      const more = button(root, 'Load more photos', () => {
        const oldLimit = this.photoLimit || PHOTO_PAGE;
        this.photoLimit = oldLimit + PHOTO_PAGE;
        this.render();
        this.contentEl.querySelectorAll?.('.ji-timeline-photo .ji-photo-tile')[oldLimit]?.focus();
      }, 'ji-button ji-more');
      more.setAttribute('data-ji-focus', 'photo-more');
    }
  };
}

module.exports = { install, fold, queryText, searchEntry, excerpt, photoTimeline };

return module.exports;})();
const toolsModule = (()=>{const module={exports:{}};
'use strict';

function remapPaths(paths, oldPath, newPath, includeChildren = false) {
  return [...new Set((paths || []).map(path => {
    if (path === oldPath) return newPath;
    if (includeChildren && path.startsWith(oldPath + '/')) return newPath + path.slice(oldPath.length);
    return path;
  }))];
}

function visibleSaved(entries, prefs, today, memoryEligible) {
  const byPath = new Map(entries.map(entry => [entry.file.path, entry]));
  return prefs.savedMemories.flatMap(path => {
    const entry = byPath.get(path);
    return entry && entry.date <= today && memoryEligible(entry, prefs.excluded) ? [entry] : [];
  });
}

function journalsApi(app) {
  return app.plugins?.getPlugin?.('journals')?.api ?? app.plugins?.plugins?.journals?.api;
}

async function openThroughJournals(app, day) {
  const api = journalsApi(app);
  if (typeof api?.openNote !== 'function') return false;
  await api.openNote({ writeType: 'day' }, day, { openMode: 'tab' });
  return true;
}

class RatingChangedError extends Error {}

async function updateRating({ fileManager, file, date, value, expected, dateFromFile, metrics }) {
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new RangeError('Choose an integer rating from 1 to 10.');
  }
  if (!fileManager?.processFrontMatter) throw new Error('Note properties are unavailable.');
  await fileManager.processFrontMatter(file, properties => {
    if (dateFromFile(file, properties) !== date || metrics.score(properties.dayRating) !== expected) {
      throw new RatingChangedError('The note date or rating changed before saving.');
    }
    properties.dayRating = value;
  });
}

function install(JournalView, { el, button, formatDate, localKey, TFile, Modal, Notice,
  metrics, review, dateFromFile, memoryEligible, Platform }) {
  const eligible = (view, entry) => entry.date <= localKey(new Date()) && memoryEligible(entry, view.prefs().excluded);

  JournalView.prototype.openEntry = async function(entry) {
    const path = entry.file.path;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice('This journal note is no longer available.');
      return false;
    }
    try {
      const workspace = this.app.workspace;
      const existing = workspace.getLeavesOfType?.('markdown').find(leaf => leaf.view?.file === file);
      if (existing) await workspace.revealLeaf(existing);
      else await workspace.getLeaf('tab').openFile(file);
      return true;
    } catch {
      new Notice('Could not open the journal note.');
      return false;
    }
  };

  JournalView.prototype.withToday = async function(action) {
    if (this.todayBusy) return;
    this.todayBusy = true;
    try { await action(); }
    finally { this.todayBusy = false; }
  };

  JournalView.prototype.todayEntries = async function(date) {
    const snapshot = await this.plugin.journalIndex.update();
    return snapshot.entries.filter(entry => entry.date === date);
  };

  JournalView.prototype.pickDaily = function(title, entries, onPick) {
    const modal = new Modal(this.app);
    modal.onOpen = () => {
      const root = modal.contentEl;
      root.empty();
      el(root, 'h2', 'ji-modal-heading', title);
      const list = el(root, 'div', 'ji-modal-list');
      for (const entry of entries) {
        const label = entry.file.path + (entry.rating === null ? '' : ' · ' + entry.rating + ' / 10');
        button(list, label, () => { modal.close(); onPick(entry); }, 'ji-button ji-note-choice');
      }
    };
    modal.open();
  };

  JournalView.prototype.openToday = function() {
    return this.withToday(async () => {
      const today = localKey(new Date());
      try {
        const entries = await this.todayEntries(today);
        if (entries.length === 1) await this.openEntry(entries[0]);
        else if (entries.length > 1) this.pickDaily('Choose today’s note', entries, entry => this.openEntry(entry));
        else if (!await openThroughJournals(this.app, today)) {
          new Notice('Enable the Journals plugin to create today’s note from its template.');
        }
      } catch (error) {
        if (error?.code !== 'cancelled' && error?.code !== 'canceled') {
          new Notice('Journals could not open or create today’s note. Check its Daily journal settings.');
        }
      }
    });
  };

  JournalView.prototype.quickRating = function() {
    return this.withToday(async () => {
      try {
        const today = localKey(new Date());
        const entries = await this.todayEntries(today);
        if (!entries.length) {
          new Notice('Use Today to open or create your note first.');
          return;
        }
        if (entries.length === 1) this.rateEntry(entries[0]);
        else this.pickDaily('Choose the note to rate', entries, entry => this.rateEntry(entry));
      } catch {
        new Notice('Could not find today’s notes.');
      }
    });
  };

  JournalView.prototype.rateEntry = function(entry) {
    const modal = new Modal(this.app);
    modal.onOpen = () => {
      const root = modal.contentEl;
      root.empty();
      el(root, 'h2', 'ji-modal-heading', 'Quick Rating');
      el(root, 'p', 'ji-muted ji-modal-path', entry.file.path);
      const label = el(root, 'label', 'ji-date-label');
      el(label, 'span', '', 'Day rating');
      const input = el(label, 'select', 'ji-select');
      el(input, 'option', '', 'Choose a rating').value = '';
      if (entry.rating !== null && !Number.isInteger(entry.rating)) {
        el(input, 'option', '', 'Current: ' + entry.rating + ' / 10').value = String(entry.rating);
      }
      for (let n = 1; n <= 10; n++) el(input, 'option', '', n + ' / 10').value = String(n);
      input.value = entry.rating === null ? '' : String(entry.rating);
      const status = el(root, 'p', 'ji-settings-error');
      status.setAttribute('role', 'alert');
      const save = button(root, 'Save rating', async () => {
        const value = Number(input.value);
        const file = this.app.vault.getAbstractFileByPath(entry.file.path);
        if (file !== entry.file || this.plugin.journalKind(file?.path || '') !== 'daily') {
          status.textContent = 'This note moved or changed. Reopen Quick Rating and choose the note again.';
          return;
        }
        save.disabled = input.disabled = true;
        try {
          await updateRating({ fileManager: this.app.fileManager, file, date: entry.date,
            value, expected: entry.rating, dateFromFile, metrics });
          modal.close();
          new Notice('Rating saved.');
        } catch (error) {
          status.textContent = error instanceof RatingChangedError
            ? 'The note changed. Reopen Quick Rating to see its latest rating.'
            : 'Could not save the rating.';
          input.disabled = false;
          if (!(error instanceof RatingChangedError)) syncSave();
        }
      });
      const syncSave = () => {
        const value = Number(input.value);
        save.disabled = !Number.isInteger(value) || value < 1 || value > 10 || value === entry.rating;
      };
      input.addEventListener('change', () => { status.textContent = ''; syncSave(); });
      syncSave();
    };
    modal.open();
  };

  JournalView.prototype.renderHomeActions = function(root, today, entries) {
    el(root, 'span', 'ji-home-date', formatDate(today));
    const actions = el(root, 'div', 'ji-inline-actions');
    button(actions, 'Today', () => this.openToday(), 'ji-button ji-primary');
    if (entries.some(entry => entry.date === today)) {
      button(actions, 'Quick Rating', () => this.quickRating(), 'ji-button');
    }
  };

  JournalView.prototype.isCompactHome = function(prefs) {
    return prefs.compactHome === 'on' || (prefs.compactHome !== 'off' && Boolean(Platform?.isMobile));
  };

  JournalView.prototype.renderSaveMemory = function(root, entry) {
    if (!eligible(this, entry)) return;
    const path = entry.file.path;
    const setLabel = (control, saved) => {
      control.textContent = saved ? 'Saved' : 'Save';
      control.setAttribute('aria-pressed', String(saved));
      control.setAttribute('aria-label', saved ? 'Remove saved memory for ' + entry.date : 'Save memory for ' + entry.date);
    };
    const control = button(root, '', async () => {
      if (!eligible(this, entry)) return;
      const old = this.prefs().savedMemories;
      const add = !old.includes(path);
      const paths = add ? [path, ...old] : old.filter(item => item !== path);
      control.disabled = true;
      try {
        if (!await this.savePrefs({ savedMemories: paths })) return;
        if (this.tab === 'memories' && this.memoriesMode === 'saved') {
          this.render();
          this.contentEl.querySelector?.('[data-ji-focus="memory-saved"]')?.focus({ preventScroll: true });
          return;
        }
        for (const matching of this.contentEl.querySelectorAll('.ji-save-memory')) {
          if (matching.getAttribute('data-ji-path') === path) setLabel(matching, add);
        }
      } finally { control.disabled = false; }
    }, 'ji-link ji-save-memory');
    control.setAttribute('data-ji-path', path);
    setLabel(control, this.prefs().savedMemories.includes(path));
  };

  JournalView.prototype.renderEntryActions = function(root, entry) {
    const actions = el(root, 'div', 'ji-entry-actions');
    this.renderSaveMemory(actions, entry);
    if (entry.date) button(actions, 'Periods', () => this.showPeriods(entry.file), 'ji-link');
    if (!actions.children.length) actions.remove();
  };

  JournalView.prototype.renderMemoryNavigation = function(root, entries) {
    const heading = this.title(root, '', 'On This Day');
    const switcher = el(heading, 'div', 'ji-mode-switch');
    switcher.setAttribute('aria-label', 'Memory view');
    const mode = this.memoriesMode || 'day';
    for (const [id, label] of [['day', 'By date'], ['saved', 'Saved']]) {
      const control = button(switcher, label, () => {
        this.memoriesMode = id;
        this.clearScroll('memories');
        this.render();
        this.contentEl.querySelector?.('[data-ji-focus="memory-' + id + '"]')?.focus({ preventScroll: true });
      }, 'ji-mode-button');
      control.setAttribute('data-ji-focus', 'memory-' + id);
      control.setAttribute('aria-pressed', String(mode === id));
    }
    if (mode === 'day') return false;
    const today = localKey(new Date());
    const entriesToShow = visibleSaved(entries, this.prefs(), today, memoryEligible);
    if (entriesToShow.length) {
      const limit = this.savedLimit || 18;
      this.memoryCards(root, entriesToShow.slice(0, limit), today, false);
      if (entriesToShow.length > limit) {
        const more = button(root, 'Load more', () => {
          this.savedLimit = limit + 18;
          this.render();
          this.contentEl.querySelectorAll('.ji-memory-card .ji-button')[limit]?.focus();
        });
        more.setAttribute('data-ji-focus', 'saved-more');
      }
    } else {
      el(root, 'p', 'ji-empty', 'Save an entry to find it here.');
    }
    return true;
  };

  JournalView.prototype.showEntriesForPeriod = function(period) {
    this.query = '';
    this.entryYear = 'all';
    this.limit = 36;
    this.entryFiltersOpen = true;
    this.entryFilters = { start: period.start, end: period.end };
    this.entriesMode = 'entries';
    this.clearScroll('entries');
    this.navigate('entries');
  };

  JournalView.prototype.showPeriods = async function(file) {
    try {
      const kind = this.plugin.journalKind(file.path);
      const snapshot = await this.plugin.journalIndex.update();
      const daily = kind === 'daily' && snapshot.entries.find(row => row.file.path === file.path);
      const current = snapshot.periods.find(row => row.file.path === file.path);
      if (!daily?.date && !current?.period) {
        new Notice('This note has no recognized journal date.');
        return;
      }

      const modal = new Modal(this.app);
      modal.onOpen = () => {
        const root = modal.contentEl;
        root.empty();
        el(root, 'h2', 'ji-modal-heading', 'Journal Periods');
        if (daily) {
          el(root, 'p', 'ji-muted', formatDate(daily.date));
          for (const [key, label] of Object.entries(review.PERIODS)) {
            const row = el(root, 'div', 'ji-period-row');
            el(row, 'span', 'ji-setting-name', label);
            const matches = snapshot.periods.filter(item =>
              item.kind === key && item.period.start <= daily.date && item.period.end >= daily.date);
            for (const item of matches) {
              const link = button(row, item.file.basename, () => { modal.close(); this.openEntry(item); }, 'ji-link');
              link.title = item.file.path;
            }
            if (!matches.length) el(row, 'span', 'ji-muted', 'No note');
          }
        } else {
          const { start, end } = current.period;
          const date = value => formatDate(value, { month: 'short', day: 'numeric', year: 'numeric' });
          el(root, 'p', 'ji-muted', date(start) + ' – ' + date(end));
          button(root, 'View daily entries', () => {
            modal.close();
            this.app.workspace.revealLeaf(this.leaf);
            this.showEntriesForPeriod(current.period);
          }, 'ji-button');
        }
      };
      modal.open();
    } catch { new Notice('Could not open journal periods.'); }
  };
}

module.exports = { install, remapPaths, visibleSaved, openThroughJournals, updateRating, RatingChangedError };

return module.exports;})();
const reviewModule = (()=>{const module={exports:{}};
'use strict';

const PERIODS = {
  weekly: 'Week',
  monthly: 'Month',
  quarterly: 'Quarter',
  yearly: 'Year'
};

function dateProperty(value, metrics) {
  const key = value instanceof Date && Number.isFinite(value.valueOf())
    ? value.toISOString().slice(0, 10)
    : String(value ?? '').slice(0, 10);
  return metrics.dayNumber(key) === null ? null : key;
}

function periodForDate(date, kind, metrics) {
  const day = metrics.dayNumber(date);
  if (day === null) return null;
  if (kind === 'weekly') {
    const weekday = (new Date(day * 86400000).getUTCDay() + 6) % 7;
    return { start: metrics.shift(date, -weekday), end: metrics.shift(date, 6 - weekday) };
  }

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (kind === 'yearly') return { start: date.slice(0, 4) + '-01-01', end: date.slice(0, 4) + '-12-31' };
  if (kind !== 'quarterly' && kind !== 'monthly') return null;
  const first = kind === 'quarterly' ? Math.floor((month - 1) / 3) * 3 + 1 : month;
  const last = kind === 'quarterly' ? first + 2 : first;
  return {
    start: date.slice(0, 4) + '-' + String(first).padStart(2, '0') + '-01',
    end: new Date(Date.UTC(year, last, 0)).toISOString().slice(0, 10)
  };
}

function readPeriod(file, kind, properties, metrics) {
  const start = dateProperty(properties['journal-start-date'], metrics);
  const end = dateProperty(properties['journal-end-date'], metrics);
  if (start && end && start <= end) return { start, end };
  if (kind === 'weekly') {
    const week = metrics.isoWeekStart(file.basename);
    if (week) return { start: week.start, end: week.end };
  }

  let named;
  if (kind === 'monthly') {
    const month = file.basename.match(/^(\d{4}-\d{2})(?:\D|$)/)?.[1];
    if (month) named = month + '-01';
  }
  if (kind === 'yearly') {
    const year = file.basename.match(/^(\d{4})(?:\D|$)/)?.[1];
    if (year) named = year + '-01-01';
  }
  if (kind === 'quarterly') {
    const match = file.basename.match(/^(\d{4})-Q([1-4])(?:\D|$)/i);
    if (match) named = match[1] + '-' + String((Number(match[2]) - 1) * 3 + 1).padStart(2, '0') + '-01';
  }
  const date = start || dateProperty(properties['journal-date'], metrics) || dateProperty(named, metrics);
  return date ? periodForDate(date, kind, metrics) : null;
}

function readReview(entries, weekly, anchor, kind, today, metrics, aggregateDays) {
  const full = periodForDate(anchor, kind, metrics);
  const range = { start: full.start, end: full.end > today ? today : full.end };
  const prior = periodForDate(metrics.shift(range.start, -1), kind, metrics);
  const records = entries.filter(entry => entry.date && entry.date >= range.start && entry.date <= range.end);
  const writing = aggregateDays(records);
  const ratings = metrics.ratings(records, range, today);
  const weeks = metrics.weekly(weekly);
  const current = metrics.selectedWeeks(weeks, range, today);
  const previous = metrics.selectedWeeks(weeks, prior, today);
  const priorScores = new Map(metrics.wheelSummary(previous).map(category => [category.key, category.value]));
  const changes = metrics.wheelSummary(current).flatMap(category => {
    const before = priorScores.get(category.key);
    if (category.value === null || before === null || before === undefined) return [];
    return [{ ...category, before, change: Math.round((category.value - before) * 10) / 10 }];
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.label.localeCompare(b.label));
  return { full, range, prior, records, writing, ratings, changes, wheelWeeks: [...current, ...previous] };
}

function readChecks(entries, today, metrics, attachmentAvailable) {
  const byDate = new Map();
  const attachments = [];
  for (const entry of entries) {
    if (entry.date) {
      if (!byDate.has(entry.date)) byDate.set(entry.date, []);
      byDate.get(entry.date).push(entry);
    }
    const missing = (entry.photos || []).filter(photo =>
      photo.kind === 'dayone' || (photo.kind === 'local' && !attachmentAvailable(photo, entry)));
    if (missing.length) attachments.push({ entry, missing });
  }
  const duplicateDates = [...byDate.entries()].filter(([, rows]) => rows.length > 1).map(([date, records]) => ({ date, records }));
  const conflicts = metrics.ratings(entries, { start: '0001-01-01', end: today }, today).conflicts.reverse();
  return { duplicateDates, conflicts, attachments };
}

function install(JournalView, { el, button, formatNumber, formatDate, localKey, metrics, aggregateDays, memoryEligible, TFile }) {
  const shortDate = date => formatDate(date, { month: 'short', day: 'numeric', year: 'numeric' });
  const score = value => formatNumber(Math.round(value * 10) / 10);
  const setFocusKey = (node, key) => node.setAttribute('data-ji-focus', key);

  JournalView.prototype.insightsTitle = function(root) {
    const heading = this.title(root, '', 'Insights');
    const switcher = el(heading, 'div', 'ji-mode-switch');
    switcher.setAttribute('aria-label', 'Insights view');
    for (const [id, label] of [['analytics', 'Analytics'], ['review', 'Review']]) {
      const mode = button(switcher, label, () => {
        this.insightsMode = id;
        this.drill = null;
        this.clearScroll('insights');
        this.render();
        this.contentEl.querySelector?.('[data-ji-focus="insights-mode-' + id + '"]')?.focus({ preventScroll: true });
      }, 'ji-mode-button');
      setFocusKey(mode, 'insights-mode-' + id);
      mode.setAttribute('aria-pressed', String((this.insightsMode || 'analytics') === id));
    }
    return heading;
  };

  JournalView.prototype.renderReview = function(root, entries) {
    const today = localKey(new Date());
    const kind = this.reviewKind || 'weekly';
    const anchor = this.reviewDate && this.reviewDate <= today ? this.reviewDate : today;
    const review = readReview(entries, this.weekEntries, anchor, kind, today, metrics, aggregateDays);
    const { range, full, prior, records, writing, ratings, changes, wheelWeeks } = review;

    const toolbar = el(root, 'div', 'ji-review-toolbar');
    const select = el(toolbar, 'select', 'ji-select');
    select.setAttribute('aria-label', 'Review period');
    setFocusKey(select, 'review-kind');
    for (const k of ['weekly', 'monthly']) el(select, 'option', '', PERIODS[k]).value = k;
    select.value = kind;
    const repeat = () => { this.drill = null; this.render(); };
    select.addEventListener('change', () => { this.reviewKind = select.value; repeat(); });

    const move = (date, label, direction) => {
      const control = button(toolbar, label, () => { this.reviewDate = date; repeat(); });
      control.setAttribute('aria-label', label + ' ' + PERIODS[kind].toLowerCase());
      control.disabled = date > today;
      setFocusKey(control, 'review-' + direction);
    };
    move(prior.start, 'Previous', 'previous');
    const date = el(toolbar, 'input', 'ji-input');
    date.type = 'date';
    date.value = anchor;
    date.max = today;
    date.setAttribute('aria-label', 'Choose a date in the review period');
    setFocusKey(date, 'review-date');
    date.addEventListener('change', () => {
      if (date.value && date.value <= today && metrics.dayNumber(date.value) !== null) {
        this.reviewDate = date.value;
        repeat();
      }
    });
    move(metrics.shift(full.end, 1), 'Next', 'next');
    const current = button(toolbar, 'This ' + PERIODS[kind].toLowerCase(), () => { this.reviewDate = today; repeat(); });
    setFocusKey(current, 'review-current');
    el(root, 'p', 'ji-period-caption', shortDate(range.start) + ' – ' + shortDate(range.end) + (range.end < full.end ? ' · In progress' : ''));

    const group = el(root, 'div', 'ji-review-grid');
    const writingPanel = el(group, 'section', 'ji-panel ji-review-card');
    this.title(writingPanel, '', 'Writing');
    const writingDays = writing.active.length;
    el(writingPanel, 'strong', 'ji-review-value', formatNumber(writingDays) + (writingDays === 1 ? ' day' : ' days'));
    el(writingPanel, 'span', 'ji-muted', formatNumber(writing.words) + ' words');
    const writingSources = records.filter(entry => entry.words > 0);
    if (writingSources.length) button(writingPanel, 'View entries', () => this.explore('Writing entries', writingSources), 'ji-link');

    const ratingPanel = el(group, 'section', 'ji-panel ji-review-card');
    this.title(ratingPanel, '', 'Daily ratings');
    el(ratingPanel, 'strong', 'ji-review-value', ratings.average === null ? '—' : score(ratings.average) + ' / 10');
    const ratedDays = ratings.data.length;
    el(ratingPanel, 'span', 'ji-muted', formatNumber(ratedDays) + (ratedDays === 1 ? ' rated day' : ' rated days'));
    if (ratedDays) button(ratingPanel, 'View ratings', () => this.explore('Rated entries', ratings.data.flatMap(day => day.records)), 'ji-link');
    if (ratings.conflicts.length) {
      button(ratingPanel, 'Conflicting ratings', () => this.explore('Conflicting ratings', ratings.conflicts.flatMap(day => day.records)), 'ji-link');
    }

    const periodNotes = this.periods.filter(row => row.kind === kind &&
      row.period.start <= anchor && row.period.end >= anchor);
    if (periodNotes.length) {
      const links = el(root, 'div', 'ji-inline-actions');
      for (const row of periodNotes) button(links, 'Open ' + PERIODS[kind].toLowerCase() + ' note', () => this.openEntry(row));
    }
    this.renderDrill(root);

    const wheel = el(root, 'section', 'ji-panel ji-review-wheel');
    this.title(wheel, '', 'Wheel of Life', 'vs. ' + shortDate(prior.start) + ' – ' + shortDate(prior.end));
    const shown = changes.filter(category => category.change !== 0).slice(0, 3);
    if (!shown.length) {
      el(wheel, 'p', 'ji-empty', changes.length ? 'No change in comparable scores.' : 'Add ratings in both periods to compare them.');
    }
    for (const category of shown) {
      const row = el(wheel, 'div', 'ji-review-wheel-row');
      el(row, 'span', '', category.label);
      el(row, 'span', 'ji-muted', score(category.before) + ' → ' + score(category.value));
      el(row, 'strong', '', (category.change > 0 ? '+' : '') + score(category.change));
    }
    const weeklySources = new Map();
    for (const week of wheelWeeks) {
      if (!Object.values(week.values).some(value => value !== null)) continue;
      for (const row of week.records) weeklySources.set(row.file.path, row);
    }
    if (weeklySources.size) {
      const details = el(wheel, 'details', 'ji-chart-details');
      el(details, 'summary', '', 'Weekly notes');
      for (const row of weeklySources.values()) button(details, row.file.basename, () => this.openEntry(row), 'ji-link ji-period-source');
    }

    const memories = el(root, 'section', 'ji-review-memories');
    this.title(memories, '', 'Entries to revisit');
    const prefs = this.prefs(), saved = new Set(prefs.savedMemories);
    const highlights = records.filter(entry => memoryEligible(entry, prefs.excluded)).sort((a, b) =>
      Number(saved.has(b.file.path)) - Number(saved.has(a.file.path)) ||
      Number(Boolean(b.photos?.length)) - Number(Boolean(a.photos?.length)) ||
      b.words - a.words || b.date.localeCompare(a.date));
    this.cards(memories, highlights.slice(0, 3), false);
  };

  JournalView.prototype.renderJournalCheck = function(root, entries) {
    const head = this.title(root, '', 'Journal Check');
    button(head, 'Back to Settings', () => this.navigate('settings'), 'ji-button ji-quiet');
    const result = readChecks(entries, localKey(new Date()), metrics, (photo, entry) => {
      try {
        return this.app.metadataCache.getFirstLinkpathDest(photo.target, entry.file.path) instanceof TFile;
      } catch { return false; }
    });

    const groups = [
      {
        label: 'Dates with multiple Daily files', rows: result.duplicateDates,
        render: (row, record) => {
          el(row, 'span', 'ji-setting-name', shortDate(record.date));
          for (const source of record.records) button(row, source.file.path, () => this.openEntry(source), 'ji-link ji-check-source');
        }
      },
      {
        label: 'Dates with conflicting ratings', rows: result.conflicts,
        render: (row, record) => {
          el(row, 'span', 'ji-setting-name', shortDate(record.date));
          for (const source of record.records) {
            button(row, source.file.path + ' · ' + score(source.rating) + ' / 10', () => this.openEntry(source), 'ji-link ji-check-source');
          }
        }
      },
      {
        label: 'Notes with unavailable images', rows: result.attachments,
        render: (row, { entry, missing }) => {
          button(row, entry.file.path, () => this.openEntry(entry), 'ji-link ji-check-source');
          const list = el(row, 'ul', 'ji-check-images');
          for (const photo of missing) {
            el(list, 'li', 'ji-muted', (photo.kind === 'dayone' ? 'Day One media: ' : 'File not found: ') + photo.target);
          }
        }
      }
    ];

    for (const { label, rows, render } of groups) {
      const section = el(root, 'details', 'ji-panel ji-check-panel');
      el(section, 'summary', '', label + ' (' + formatNumber(rows.length) + ')');
      if (!rows.length) {
        el(section, 'p', 'ji-empty', 'None found.');
        continue;
      }
      const list = el(section, 'ul', 'ji-check-list');
      let shown = 0;
      const more = button(section, 'Show more', () => append());
      const append = () => {
        for (const record of rows.slice(shown, shown + 12)) render(el(list, 'li', 'ji-check-row'), record);
        shown += 12;
        more.hidden = shown >= rows.length;
      };
      append();
    }
  };
}

module.exports = { install, PERIODS, periodForDate, readPeriod, readReview, readChecks };

return module.exports;})();
const experienceModule = (()=>{const module={exports:{}};
'use strict';

// Calendar arithmetic uses UTC day numbers; UI dates are local, never UTC timestamps.
const DAY = 86400000;
const keyDay = key => Math.floor(Date.parse(key + 'T00:00:00Z') / DAY);
const dayKey = day => new Date(day * DAY).toISOString().slice(0,10);
const shift = (key, days) => dayKey(keyDay(key) + days);
const span = (a,b) => Math.max(0,keyDay(b)-keyDay(a)+1);
const HOME = ['memories','recent','activity','stats'];
const LABELS = {memories:'On This Day',recent:'Recent Entries',activity:'Writing Activity',stats:'At a Glance'};
const percent = (a,b) => b ? Math.round(a/b*1000)/10 : 0;
function rangeFor(entries,mode,year,today,custom={}) {
  let end=today,start;
  if(mode==='30'||mode==='90') start=shift(end,1-Number(mode));
  else if(mode==='all') start=entries.filter(e=>e.date&&e.date<=today).map(e=>e.date).sort()[0]||today;
  else if(mode==='custom') {start=custom.start;end=custom.end;}
  else {start=year+'-01-01';end=Number(year)<Number(today.slice(0,4))?year+'-12-31':today;}
  const valid=k=>/^\d{4}-\d{2}-\d{2}$/.test(k||'')&&Number.isFinite(keyDay(k))&&dayKey(keyDay(k))===k;
  if(!valid(start)||!valid(end)||start>end||start>today)return {error:'Choose a valid start and end date, with the start no later than today.'};
  if(end>today)end=today;
  if(span(start,end)>366*100)return {error:'Choose a period of 100 years or less.'};
  return {start,end,days:span(start,end)};
}
function analyze(entries,range,aggregateDays,today) {
  entries=entries.filter(e=>!e.kind||e.kind==='daily');
  const inRange=e=>e.date&&e.date>=range.start&&e.date<=range.end;
  const records=entries.filter(inRange),data=aggregateDays(records,new Date(today+'T12:00:00'));
  const all=aggregateDays(entries.filter(e=>e.date&&e.date<=today));
  const months=new Map(),weeks=new Map();
  const weekdays=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(label=>({label,value:0,active:0,total:0,dates:[]}));
  const bins=[['1–99',1,99],['100–299',100,299],['300–699',300,699],['700–1,499',700,1499],['1,500+',1500,Infinity]].map(([label,min,max])=>({label,min,max,value:0,dates:[]}));
  let cumulative=0;
  for(let n=keyDay(range.start);n<=keyDay(range.end);n++) {
    const date=dayKey(n),weekday=(new Date(n*DAY).getUTCDay()+6)%7,month=date.slice(0,7),week=dayKey(n-weekday),day=data.days.get(date);
    if(!months.has(month))months.set(month,{label:month,value:0,active:0,total:0,dates:[]});
    if(!weeks.has(week))weeks.set(week,{label:week,value:0,dates:[]});
    const m=months.get(month),w=weeks.get(week),wd=weekdays[weekday];
    m.total++;wd.total++;m.dates.push(date);w.dates.push(date);wd.dates.push(date);
    if(day&&day.words>0){m.active++;wd.active++;m.value+=day.words;w.value+=day.words;const bin=bins.find(b=>day.words>=b.min&&day.words<=b.max);bin.value++;bin.dates.push(date);}
  }
  const monthly=[...months.values()];for(const m of monthly){cumulative+=m.value;m.cumulative=cumulative;m.rate=percent(m.active,m.total);}
  weekdays.forEach(d=>d.value=percent(d.active,d.total));
  const values=data.active.map(d=>d.words).sort((a,b)=>a-b),mid=Math.floor(values.length/2);
  const median=values.length?(values.length%2?values[mid]:(values[mid-1]+values[mid])/2):0;
  const previous={start:shift(range.start,-range.days),end:shift(range.start,-1)};
  const prev=aggregateDays(entries.filter(e=>e.date&&e.date>=previous.start&&e.date<=previous.end));
  const yearly=new Map();for(const d of all.active){const y=d.date.slice(0,4);if(!yearly.has(y))yearly.set(y,{label:y,value:0,dates:[]});yearly.get(y).value+=d.words;yearly.get(y).dates.push(d.date);}
  return {records,data,range,monthly,weeks:[...weeks.values()],weekdays,bins,median,previous,prev,
    rate:percent(data.active.length,range.days),average:data.active.length?Math.round(data.words/data.active.length):0,
    perCalendar:Math.round(data.words/range.days),top:[...data.active].sort((a,b)=>b.words-a.words).slice(0,5),
    yearly:[...yearly.values()].sort((a,b)=>a.label.localeCompare(b.label)),
    future:entries.filter(e=>e.date&&e.date>today).length,undated:entries.filter(e=>!e.date).length};
}
function heatValue(day,mode){return !day?0:mode==='days'?(day.words>0?1:0):mode==='entries'?day.records.filter(e=>e.words>0).length:day.words;}
function levelFor(value,mode,heatLevel){return mode==='days'?(value?4:0):mode==='entries'?Math.min(4,value):heatLevel(value);}
function memoryEligible(e,excluded){return !!(e.date&&(e.words>0||(e.photos&&e.photos.length))&&!e.private&&!excluded.includes(e.file.path));}

function install(JournalView,{el,button,formatNumber:n,formatDate:fd,localKey,validDate,aggregateDays,heatLevel,MONTHS,TFile,Notice,metrics}) {
  const methods={
    prefs(){
      if(!this.experienceReady){
        const p=this.plugin.settings.experience||{};
        this.heatMode=['words','days','entries'].includes(p.heatMode)?p.heatMode:'words';
        this.rangeMode=['30','90','year','all','custom'].includes(p.rangeMode)?p.rangeMode:'year';
        this.customRange=p.customRange||{};this.experienceReady=true;
        if(/^\d{4}$/.test(p.year||''))this.year=p.year;
      }
      const p=this.plugin.settings.experience||{};
      const paths=key=>Array.isArray(p[key])?[...new Set(p[key].filter(path=>typeof path==='string'))]:[];
      return {...p,order:[...new Set([...(Array.isArray(p.order)?p.order.filter(x=>HOME.includes(x)):[]),...HOME])],
        hidden:Array.isArray(p.hidden)?p.hidden:[],excluded:paths('excluded'),savedMemories:paths('savedMemories')};
    },
    async savePrefs(changes){
      const old=this.plugin.settings.experience,updated={...this.prefs(),...changes};
      this.plugin.settings.experience=updated;
      try{await this.plugin.saveSettings();return true;}catch(error){if(this.plugin.settings.experience===updated)this.plugin.settings.experience=old;new Notice('Could not save settings. Please try again.');return false;}
    },
    navigate(tab){if(this.tab!==tab)this.drill=null;this.tab=tab;this.render();},
    clearScroll(tab){
      this.scrollByTab.delete(tab);
      if(this.renderedTab===tab)this.contentEl.scrollTop=0;
    },
    yearControl(root,entries){
      const years=[...new Set([String(new Date().getFullYear()),...entries.filter(e=>e.date&&e.date<=localKey(new Date())).map(e=>e.date.slice(0,4))])].sort().reverse();
      if(!years.includes(this.year))this.year=years[0];const select=el(root,'select','ji-select ji-year');select.setAttribute('aria-label','Select year');for(const year of years){const o=el(select,'option','',year);o.value=year;}select.value=this.year;select.addEventListener('change',()=>{this.year=select.value;this.drill=null;this.savePrefs({year:this.year});this.render();});
    },
    render(){
      this.prefs();
      for(const observer of this.chartObservers||[])observer.disconnect();this.chartObservers=[];
      const root=this.contentEl,previous=this.renderedTab;
      if(previous)this.scrollByTab.set(previous,root.scrollTop);
      const active=root.ownerDocument?.activeElement;
      const focused=previous===this.tab&&root.contains(active)?active:null;
      const focusKey=focused?.getAttribute('data-ji-focus');
      const selection=typeof focused?.selectionStart==='number'?[focused.selectionStart,focused.selectionEnd]:null;
      root.empty();this.dayRegion=null;
      const shell=el(root,'div','ji-shell'),header=el(shell,'header','ji-header');
      const brand=el(header,'div','ji-brand');el(brand,'h1','ji-title','Journal Insights');
      const actions=el(header,'div','ji-header-actions');
      const refresh=button(actions,'Refresh',async event=>{
        const control=event.currentTarget;
        control.disabled=true;
        control.textContent='Refreshing…';
        this.plugin.journalIndex.requestScan(true);
        try{await this.plugin.refreshViews();}finally{control.disabled=false;}
      },'ji-button ji-quiet');
      refresh.setAttribute('data-ji-focus','refresh');
      const nav=el(shell,'nav','ji-nav');nav.setAttribute('aria-label','Journal navigation');
      const activeTab=this.tab==='check'?'settings':this.tab;
      for(const [id,label] of [['home','Home'],['entries','Entries'],['calendar','Calendar'],['memories','On This Day'],['insights','Insights'],['settings','Settings']]){
        const b=button(nav,label,()=>{
          this.navigate(id);
          this.contentEl.querySelector?.('[data-ji-focus="nav-'+id+'"]')?.focus({preventScroll:true});
        },'ji-nav-item'+(activeTab===id?' is-active':''));
        b.setAttribute('data-ji-focus','nav-'+id);
        if(activeTab===id)b.setAttribute('aria-current','page');
      }
      if(this.failed)el(shell,'p','ji-warning','Could not read '+this.failed+' files. Refresh to retry.');
      const entries=this.subset();
      const needsDays=this.tab==='home'||this.tab==='calendar';
      const stats=needsDays?aggregateDays(entries.filter(e=>e.date&&e.date<=localKey(new Date()))):null;
      const main=el(shell,'main','ji-main');main.setAttribute('aria-label','Journal Insights content');
      if(this.tab==='home')this.renderHome(main,entries,stats);
      if(this.tab==='entries')this.renderEntries(main,entries);
      if(this.tab==='calendar')this.renderCalendar(main,entries,stats);
      if(this.tab==='memories')this.renderMemories(main,entries);
      if(this.tab==='insights'){
        this.insightsTitle(main);
        if(this.insightsMode==='review')this.renderReview(main,entries);
        else this.renderInsights(main,entries);
      }
      if(this.tab==='settings')this.renderSettings(main);
      if(this.tab==='check')this.renderJournalCheck(main,entries);
      this.renderedTab=this.tab;
      root.scrollTop=this.scrollByTab.get(this.tab)||0;
      if(focusKey){
        const target=root.querySelector?.('[data-ji-focus="'+focusKey+'"]');
        target?.focus({preventScroll:true});
        if(selection)target?.setSelectionRange?.(...selection);
      }
    },
    metric(root,value,label,note){const box=el(root,'div','ji-stat');el(box,'span','ji-stat-label',label);el(box,'strong','ji-stat-number',value);if(note){box.title=note;box.setAttribute('role','group');box.setAttribute('aria-label',label+': '+value+'. '+note);}return box;},
    renderHome(root,entries,stats){
      const today=localKey(new Date());
      const top=el(root,'div','ji-home-top');
      this.renderHomeActions(top,today,entries);
      const prefs=this.prefs();
      const compact=this.isCompactHome(prefs);
      const visible=prefs.order.filter(id=>!prefs.hidden.includes(id)&&(!compact||id==='memories'||id==='recent'));
      const sections=el(root,'div','ji-home-layout'+(compact?' ji-home-compact':''));
      for(const id of visible){
        const section=el(sections,'section','ji-panel ji-home-'+id);
        if(id==='memories'){
          const h=this.title(section,'','On This Day');button(h,'View all',()=>{this.memoriesMode='day';this.navigate('memories');},'ji-link');
          const memories=this.memoriesFor(entries,today);
          if(memories.length)this.memoryCards(section,memories.slice(0,compact?1:2),today);else{el(section,'p','ji-empty','No memories for today.');button(section,'Random Memory',()=>this.randomMemory(entries),'ji-button');}
        }else if(id==='recent'){
          const h=this.title(section,'','Recent Entries');button(h,'View all',()=>{this.entriesMode='entries';this.navigate('entries');},'ji-link');this.cards(section,entries.filter(e=>e.words>0||e.photos?.length).slice(0,compact?2:3),true);
        }else if(id==='activity'){
          const h=this.title(section,'','Writing Activity');this.yearControl(h,entries);this.heatmap(section,stats,Number(this.year));
        }else{this.title(section,'','At a Glance');const grid=el(section,'div','ji-stats'),streak=metrics.journalStreak(stats.days,localKey(new Date()));this.metric(grid,n(stats.active.length),'Writing days','Unique dates with text');this.metric(grid,n(stats.words),'Words written','Estimated, through today');this.metric(grid,n(streak.current),'Current streak','Days with text or linked images, through today or yesterday');this.metric(grid,n(streak.longest),'Longest streak','Consecutive days with text or linked images');const details=el(section,'details','ji-heat-about');el(details,'summary','','Streak details');el(details,'p','ji-settings-help','A journal day has text or at least one linked image. Empty templates do not count. '+(streak.current?'Current streak includes '+n(streak.photoOnly)+' photo-only '+(streak.photoOnly===1?'day.':'days.'):'No current streak.')+(streak.breakHasNote?' Last break: '+fd(streak.breakDate)+' (note has no text or linked images).':' Last break: '+fd(streak.breakDate)+' (no daily note).'));button(section,'View insights',()=>this.navigate('insights'),'ji-link');}
      }
      if(!visible.length){el(root,'p','ji-empty','All Home sections are hidden.');button(root,'Open Settings',()=>this.navigate('settings'),'ji-button');}
      this.renderDrill(root);
    },
    renderSettings(root){
      this.title(root,'','Settings');
      const settings=el(root,'div','ji-settings');
      const general=el(settings,'section','ji-settings-section');el(general,'h3','ji-settings-title','General');
      const startup=el(general,'label','ji-setting-row ji-startup-row');
      const startupCopy=el(startup,'div','ji-setting-copy');el(startupCopy,'span','ji-setting-name','Open at startup');
      const startCheck=el(startup,'input');startCheck.type='checkbox';startCheck.checked=this.plugin.settings.openOnStartup!==false;
      startCheck.addEventListener('change',async()=>{const old=this.plugin.settings.openOnStartup;this.plugin.settings.openOnStartup=startCheck.checked;try{await this.plugin.saveSettings();}catch(error){this.plugin.settings.openOnStartup=old;startCheck.checked=old!==false;new Notice('Could not save settings. Please try again.');}});

      const home=el(settings,'section','ji-settings-section');el(home,'h3','ji-settings-title','Home');
      const prefs=this.prefs();
      const compact=el(home,'label','ji-setting-row');
      el(compact,'span','ji-setting-name','Compact Home');
      const layout=el(compact,'select','ji-select');
      layout.setAttribute('data-ji-focus','compact-home');
      for(const [id,label] of [['auto','Automatic on mobile'],['on','Always'],['off','Never']])el(layout,'option','',label).value=id;
      layout.value=['on','off'].includes(prefs.compactHome)?prefs.compactHome:'auto';
      layout.addEventListener('change',async()=>{await this.savePrefs({compactHome:layout.value});this.render();});
      const list=el(home,'div','ji-settings-list');
      const updateHome=async(change,focus)=>{await this.savePrefs(change);this.render();const target=this.contentEl.querySelector&&this.contentEl.querySelector('[data-focus="'+focus+'"]');if(target)target.focus();};
      prefs.order.forEach((id,i)=>{
        const row=el(list,'div','ji-setting-row ji-home-setting'),label=el(row,'label','ji-toggle-label');
        const check=el(label,'input');check.type='checkbox';check.checked=!prefs.hidden.includes(id);check.setAttribute('data-focus',id);el(label,'span','ji-setting-name',LABELS[id]);
        check.addEventListener('change',()=>updateHome({hidden:check.checked?prefs.hidden.filter(x=>x!==id):[...prefs.hidden,id]},id));
        const moves=el(row,'div','ji-setting-actions');
        for(const [dir,labelText] of [[-1,'Move up'],[1,'Move down']]){
          const b=button(moves,dir<0?'↑':'↓',()=>{const order=[...prefs.order];[order[i],order[i+dir]]=[order[i+dir],order[i]];updateHome({order},id);},'ji-button ji-move');
          b.disabled=i+dir<0||i+dir>=prefs.order.length;b.setAttribute('aria-label',labelText+' '+LABELS[id]);b.title=labelText;
        }
      });

      const pictures=el(settings,'section','ji-settings-section');el(pictures,'h3','ji-settings-title','Pictures');
      for(const [key,label] of [['showPhotoPreviews','Show photos in Journal Insights'],['photoGalleryInNotes','Arrange photos in daily notes']]){
        const row=el(pictures,'label','ji-setting-row');el(row,'span','ji-setting-name',label);const input=el(row,'input');input.type='checkbox';input.checked=this.prefs()[key]!==false;
        input.addEventListener('change',async()=>{const ok=await this.savePrefs({[key]:input.checked});if(ok&&key==='photoGalleryInNotes'&&this.plugin.updatePhotoEditor)this.plugin.updatePhotoEditor();if(ok&&key==='photoGalleryInNotes')new Notice('Reopen a note to refresh Reading view.');this.render();});
      }
      const memories=el(settings,'section','ji-settings-section');el(memories,'h3','ji-settings-title','Memories');
      el(memories,'p','ji-settings-help','Hide entries from On This Day, Saved, Photo Timeline and Review highlights.');
      const search=el(memories,'input','ji-input ji-settings-search');search.type='search';search.placeholder='Find an entry by name or date';search.value=this.memorySearch||'';search.setAttribute('aria-label','Find an entry to hide from Memories');
      const results=el(memories,'div','ji-settings-results');results.setAttribute('aria-live','polite');
      const drawResults=()=>{
        results.empty();const q=(this.memorySearch||'').trim().toLocaleLowerCase();if(!q)return;
        const found=this.entries.filter(e=>e.date&&(e.words>0||(e.photos&&e.photos.length))&&(e.file.basename+' '+e.file.path+' '+e.date).toLocaleLowerCase().includes(q));
        if(!found.length){el(results,'p','ji-settings-help','No matching entries.');return;}
        for(const entry of found.slice(0,12)){
          const row=el(results,'div','ji-setting-row'),copy=el(row,'div','ji-setting-copy');el(copy,'span','ji-setting-name',entry.file.basename);el(copy,'span','ji-setting-path',entry.file.path);
          const hidden=this.prefs().excluded.includes(entry.file.path);
          if(entry.private)el(row,'span','ji-settings-help','Hidden by note property');
          else button(row,hidden?'Restore':'Hide',async()=>{const excluded=hidden?this.prefs().excluded.filter(p=>p!==entry.file.path):[...new Set([...this.prefs().excluded,entry.file.path])];if(await this.savePrefs({excluded})){if(this.randomEntry&&this.randomEntry.file.path===entry.file.path)this.randomEntry=null;this.render();const input=this.contentEl.querySelector&&this.contentEl.querySelector('.ji-settings-search');if(input)input.focus();}},'ji-button ji-small');
        }
        if(found.length>12)el(results,'p','ji-settings-help','Showing 12 of '+n(found.length)+' matches. Refine your search.');
      };
      search.addEventListener('input',()=>{this.memorySearch=search.value;drawResults();});drawResults();
      const inDaily=path=>path.startsWith((this.plugin.settings.dailyFolder||'').replace(/\/+$/,'')+'/');
      const hidden=this.prefs().excluded.filter(inDaily),heading=el(memories,'div','ji-settings-subheading');el(heading,'h4','','Hidden entries ('+n(hidden.length)+')');
      if(hidden.length>1)button(heading,'Restore all',async()=>{if(await this.savePrefs({excluded:this.prefs().excluded.filter(p=>!inDaily(p))}))this.render();},'ji-link');
      if(!hidden.length)el(memories,'p','ji-settings-help','None');
      for(const path of hidden){
        const row=el(memories,'div','ji-setting-row'),copy=el(row,'div','ji-setting-copy'),entry=this.entries.find(e=>e.file.path===path);
        el(copy,'span','ji-setting-name',entry?entry.file.basename:path.split('/').pop());el(copy,'span','ji-setting-path',path+(entry?'':' · Not found'));
        button(row,'Restore',async()=>{if(await this.savePrefs({excluded:this.prefs().excluded.filter(p=>p!==path)}))this.render();},'ji-button ji-small');
      }
      const privacy=el(memories,'details','ji-settings-details');el(privacy,'summary','','Note properties');el(privacy,'p','ji-settings-help','Notes with private: true or journal-insights-hide: true are also excluded from Memories. These properties do not encrypt or hide the note elsewhere.');

      const advanced=el(settings,'section','ji-settings-section');el(advanced,'h3','ji-settings-title','Folders');
      const folderInputs={};
      for(const [key,label] of [['dailyFolder','Daily folder'],['weeklyFolder','Weekly folder'],
        ['monthlyFolder','Monthly folder'],['quarterlyFolder','Quarterly folder'],['yearlyFolder','Yearly folder']]){
        const lab=el(advanced,'label','ji-folder-row');el(lab,'span','ji-setting-name',label);const input=el(lab,'input','ji-input');input.type='text';input.value=this.plugin.settings[key]||'';folderInputs[key]=input;
      }
      const error=el(advanced,'p','ji-settings-error');error.setAttribute('role','alert');
      button(advanced,'Save folders',async event=>{
        const b=event.currentTarget||event.target;
        const clean=value=>value.trim().replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
        const next=Object.fromEntries(Object.entries(folderInputs).map(([key,input])=>[key,clean(input.value)]));
        const exists=path=>path&&!path.split('/').some(part=>part==='.'||part==='..'||!part)&&this.app.vault.getAbstractFileByPath&&Array.isArray(this.app.vault.getAbstractFileByPath(path)?.children);
        const paths=Object.values(next).filter(Boolean);
        if(!next.dailyFolder||!paths.every(exists)||new Set(paths).size!==paths.length){error.textContent='Choose distinct existing folders. Daily is required.';return;}
        error.textContent='';b.disabled=true;
        const before=Object.fromEntries(Object.keys(next).map(key=>[key,this.plugin.settings[key]]));
        Object.assign(this.plugin.settings,next);
        try{await this.plugin.saveSettings();}catch(e){Object.assign(this.plugin.settings,before);error.textContent='Could not save folders. Please try again.';b.disabled=false;return;}
        new Notice('Folders saved.');try{await this.plugin.reindexFolders();}finally{b.disabled=false;}
      },'ji-button');
      const check=el(settings,'section','ji-settings-section');
      el(check,'h3','ji-settings-title','Journal Check');
      button(check,'Open Journal Check',()=>this.navigate('check'));
      const maintenance=el(settings,'details','ji-settings-details ji-maintenance');el(maintenance,'summary','','Maintenance');
      el(maintenance,'p','ji-settings-help','Repair legacy Pixel Banner properties with a backup.');
      button(maintenance,'Repair banners',()=>this.plugin.repairBanners(),'ji-button');
      el(maintenance,'p','ji-settings-help','Remove empty Quick Notes and Q&A headings from Daily notes and the standard Daily template. Existing content and quick-note markers are preserved; a backup is created.');
      button(maintenance,'Clean empty Daily sections',()=>this.plugin.cleanupDailySections(),'ji-button');
    },
    memoriesFor(entries,key){return entries.filter(e=>memoryEligible(e,this.prefs().excluded)&&e.date.slice(5)===key.slice(5)&&e.date.slice(0,4)<key.slice(0,4));},
    randomMemory(entries){
      const candidates=entries.filter(e=>memoryEligible(e,this.prefs().excluded)&&e.date<localKey(new Date())&&(!this.randomEntry||e.file.path!==this.randomEntry.file.path));
      if(!candidates.length){new Notice('No other memories available.');return;}
      this.randomEntry=candidates[Math.floor(Math.random()*candidates.length)];
      this.memoriesMode='day';this.clearScroll('memories');this.navigate('memories');
    },
    memoryCards(root,entries,reference,showAge=true){
      const grid=el(root,'div','ji-memory-cards');
      for(const entry of entries){const card=el(grid,'article','ji-memory-card');
        if(this.plugin.photoController&&this.plugin.settings.experience?.showPhotoPreviews!==false)this.plugin.photoController.gallery(card,entry.photos,entry.file.path,{limit:3,className:'ji-memory-photos'});
        const content=el(card,'div','ji-memory-copy'),years=Number(reference.slice(0,4))-Number(entry.date.slice(0,4));
        if(showAge)el(content,'span','ji-memory-age',years>0?years+' '+(years===1?'year':'years')+' ago':'Earlier this year');
        el(content,'h3','ji-memory-date',fd(entry.date));
        if(entry.text)el(content,'p','ji-memory-excerpt',entry.text.slice(0,330)+(entry.text.length>330?'…':''));
        const actions=el(content,'div','ji-memory-actions');button(actions,'Read Entry',()=>this.openEntry(entry),'ji-button');
        this.renderSaveMemory(actions,entry);
      }
    },
    renderMemories(root,entries){
      if(this.renderMemoryNavigation(root,entries))return;
      const tools=el(root,'div','ji-memory-tools');
      const input=el(tools,'input','ji-input ji-date-input');input.type='date';input.value=this.memoryDate;input.max=localKey(new Date());input.setAttribute('aria-label','Select a date for memories');
      input.setAttribute('data-ji-focus','memory-date');
      input.addEventListener('change',()=>{if(input.value&&input.value<=localKey(new Date())&&validDate(...input.value.split('-'))===input.value){this.memoryDate=input.value;this.randomEntry=null;this.render();}});
      button(tools,'Today',()=>{this.memoryDate=localKey(new Date());this.randomEntry=null;this.render();},'ji-button');button(tools,'Random Memory',()=>this.randomMemory(entries),'ji-button');
      const random=this.randomEntry&&entries.find(entry=>entry.file.path===this.randomEntry.file.path);
      if(random&&random.date<=localKey(new Date())&&memoryEligible(random,this.prefs().excluded)){
        const panel=el(root,'section','ji-panel ji-random-panel');const rh=this.title(panel,'','Random Memory');button(rh,'Dismiss',()=>{this.randomEntry=null;this.render();},'ji-link');this.memoryCards(panel,[random],localKey(new Date()));
      }
      const found=this.memoriesFor(entries,this.memoryDate),years=[...new Set(found.map(e=>e.date.slice(0,4)))].sort().reverse();
      if(!found.length){const empty=el(root,'div','ji-memory-empty');el(empty,'p','ji-muted','No memories for this date.');}
      for(const year of years){const group=el(root,'section','ji-memory-year');el(group,'h3','ji-year-label',year);this.memoryCards(group,found.filter(e=>e.date.startsWith(year)),this.memoryDate);}
    },
    heatmap(root,stats,year){
      const mode=this.heatMode||'words',tools=el(root,'div','ji-heat-toolbar'),select=el(tools,'select','ji-select');select.setAttribute('aria-label','Heatmap metric');
      for(const [id,label] of [['words','Words'],['days','Writing Days'],['entries','Entries']]){const o=el(select,'option','',label);o.value=id;}select.value=mode;select.addEventListener('change',()=>{this.heatMode=select.value;this.savePrefs({heatMode:this.heatMode});this.render();});
      const days=stats.active.filter(d=>d.date.startsWith(String(year))),total=days.reduce((s,d)=>s+d.words,0);
      el(tools,'span','ji-muted',n(days.length)+' writing days · '+n(total)+' words');
      const legend=el(root,'div','ji-legend');legend.setAttribute('aria-label','Heatmap scale');
      const bins=mode==='days'?[[0,'No writing'],[4,'Writing day']]:mode==='entries'?[[0,'0'],[1,'1'],[2,'2'],[3,'3'],[4,'4+']]:[[0,'0'],[1,'1–99'],[2,'100–299'],[3,'300–699'],[4,'700+']];
      for(const [level,label] of bins){const item=el(legend,'span','ji-legend-item');el(item,'span','ji-legend-swatch ji-level-'+level);el(item,'span','',label);}el(legend,'span','ji-muted',mode==='words'?'words / day':mode==='entries'?'nonempty files / day':'');
      const future=el(legend,'span','ji-legend-item');el(future,'span','ji-legend-swatch is-future');el(future,'span','','Future');
      const photoOnly=el(legend,'span','ji-legend-item');el(photoOnly,'span','ji-legend-swatch ji-photo-only');el(photoOnly,'span','','Photo-only day');
      const detail=el(root,'p','ji-heat-detail','');detail.setAttribute('role','status');
      const wrap=el(root,'div','ji-months'),today=localKey(new Date());
      for(let month=0;month<12;month++){
        const section=el(wrap,'section','ji-month');el(section,'h3','ji-month-title',MONTHS[month]);const grid=el(section,'div','ji-calendar-grid');
        for(const d of ['M','T','W','T','F','S','S'])el(grid,'span','ji-weekday',d);
        const offset=(new Date(year,month,1,12).getDay()+6)%7;for(let i=0;i<offset;i++)el(grid,'span','ji-day-spacer');
        for(let day=1;day<=new Date(year,month+1,0).getDate();day++){
          const key=validDate(year,month+1,day),record=stats.days.get(key),value=heatValue(record,mode),isFuture=key>today;
          const imageCount=record?record.records.reduce((sum,e)=>sum+(e.photos?.length||0),0):0;
          const label=fd(key)+': '+n(record?record.words:0)+' words · '+n(imageCount)+' linked images · '+n(record?record.records.filter(e=>e.words>0).length:0)+' entries with text'+(isFuture?' · Future date':'');
          const b=button(grid,String(day),()=>{this.selectedDay=key;if(this.tab!=='calendar'){this.tab='calendar';this.year=String(year);this.render();this.showDay(key,true);}else{this.showDay(key,true);for(const x of grid.querySelectorAll?wrap.querySelectorAll('[aria-pressed]'):[])x.setAttribute('aria-pressed','false');b.setAttribute('aria-pressed','true');}},'ji-day '+(isFuture?'is-future':'ji-level-'+levelFor(value,mode,heatLevel))+(!isFuture&&record&&!record.words&&imageCount?' ji-photo-only':'')+(key===today?' is-today':''));
          b.disabled=isFuture;b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-pressed',String(this.selectedDay===key));if(key===today)b.setAttribute('aria-current','date');b.addEventListener('mouseenter',()=>detail.textContent=label);b.addEventListener('focus',()=>detail.textContent=label);
        }
      }
      const about=el(root,'details','ji-heat-about');el(about,'summary','','About this heatmap');
      el(about,'p','ji-settings-help','Word colors use fixed thresholds. Conflicting daily notes count as the longest version per day. Entries counts all nonempty files, including conflicting versions. Future dates are excluded.');
    },
    explore(label,entries){this.drill={label,entries,limit:12};this.render();const region=this.contentEl.querySelector&&this.contentEl.querySelector('.ji-drill');if(region){region.scrollIntoView({block:'start',behavior:'auto'});region.focus();}},
    renderDrill(root){
      if(!this.drill)return;const section=el(root,'section','ji-panel ji-drill');section.setAttribute('tabindex','-1');const h=this.title(section,'BEHIND THE NUMBERS',this.drill.label,n(this.drill.entries.length)+' source files');button(h,'Close details',()=>{this.drill=null;this.render();},'ji-button');
      this.cards(section,this.drill.entries.slice(0,this.drill.limit),true);
      if(this.drill.entries.length>this.drill.limit)button(section,'Show more entries',()=>{this.drill.limit+=12;this.render();},'ji-button');
    },
    chartDetails(panel,items,unit,entries,explanation){
      const details=el(panel,'details','ji-chart-details');el(details,'summary','','View data');if(explanation)el(details,'p','ji-chart-description',explanation);const table=el(details,'table','ji-table');const head=el(table,'thead'),hr=el(head,'tr');for(const text of ['Period / group',unit,'Entries']){const th=el(hr,'th','',text);th.setAttribute('scope','col');}const body=el(table,'tbody');
      for(const item of items){const tr=el(body,'tr');el(tr,'td','',item.label);el(tr,'td','',n(item.value));const cell=el(tr,'td');const dates=new Set(item.dates||[]),matches=entries.filter(e=>dates.has(e.date)&&e.words>0&&(!item.kind||e.kind===item.kind));if(matches.length)button(cell,'Explore',()=>this.explore(item.label,matches),'ji-link');else el(cell,'span','ji-muted','—');}
    },
    barChart(parent,title,items,unit,detail,entries,maxOverride){
      const panel=el(parent,'section','ji-panel ji-chart-panel');this.title(panel,'',title);
      const max=maxOverride||Math.max(1,...items.map(x=>x.value));const chart=el(panel,'div','ji-bar-chart');chart.setAttribute('aria-label',title);
      for(const item of items){const row=button(chart,'',()=>{const dates=new Set(item.dates||[]);this.explore(title+' · '+item.label,entries.filter(e=>dates.has(e.date)&&e.words>0));},'ji-bar-row ji-bar-button');row.setAttribute('aria-label',item.label+': '+n(item.value)+' '+unit+'. Explore entries.');el(row,'span','ji-bar-label',item.label);const track=el(row,'span','ji-bar-track'),bar=el(track,'span','ji-bar');bar.style.width=(item.value/max*100)+'%';el(row,'span','ji-bar-value',n(item.value)+(unit==='%'?'%':''));}
      el(panel,'p','ji-chart-unit','0 – '+n(max)+' '+unit);this.chartDetails(panel,items,unit,entries,detail);return panel;
    },
    lineChart(parent,title,items,detail,entries){
      const panel=el(parent,'section','ji-panel ji-chart-panel ji-chart-wide');this.title(panel,'',title);
      const max=Math.max(1,...items.map(x=>x.value));
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','ji-line-chart');svg.setAttribute('role','img');svg.setAttribute('aria-label',title+'. '+items.length+' points; exact values and linked entries are available in View data.');panel.appendChild(svg);
      const node=(tag,attrs,text)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=text;svg.appendChild(e);return e;};
      const draw=()=>{
      if(svg.replaceChildren)svg.replaceChildren();else if(svg.empty)svg.empty();
      const W=Math.max(280,(panel.clientWidth||764)-44),H=230,L=58,R=12,T=20,B=40;
      svg.setAttribute('viewBox','0 0 '+W+' '+H);
      for(let i=0;i<4;i++){const y=T+(H-T-B)*i/3;node('line',{x1:L,x2:W-R,y1:y,y2:y,class:'ji-chart-gridline'});node('text',{x:L-10,y:y+4,'text-anchor':'end',class:'ji-axis-text'},n(Math.round(max*(1-i/3))));}
      const x=i=>L+(W-L-R)*(items.length<2?.5:i/(items.length-1)),y=v=>H-B-v/max*(H-T-B);
      if(items.length){node('polyline',{points:items.map((d,i)=>x(i)+','+y(d.value)).join(' '),class:'ji-chart-line'});for(let i=0;i<items.length;i++){const c=node('circle',{cx:x(i),cy:y(items[i].value),r:items.length<20?3:2,class:'ji-chart-point'});const tooltip=document.createElementNS('http://www.w3.org/2000/svg','title');tooltip.textContent=items[i].label+': '+n(items[i].value)+' words';c.appendChild(tooltip);}for(const i of [...new Set([0,Math.floor((items.length-1)/2),items.length-1])])node('text',{x:x(i),y:H-12,'text-anchor':i===0?'start':i===items.length-1?'end':'middle',class:'ji-axis-text'},items[i].label);}
      };draw();
      if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(draw);observer.observe(panel);(this.chartObservers||(this.chartObservers=[])).push(observer);}
      this.chartDetails(panel,items,'Words',entries,detail);return panel;
    },
    renderInsights(root,entries){
      const controls=el(root,'div','ji-insight-controls');
      const select=el(controls,'select','ji-select');select.setAttribute('aria-label','Insights period');for(const [id,label] of [['30','Last 30 days'],['90','Last 90 days'],['year','Selected year'],['all','All time'],['custom','Custom dates']]){const o=el(select,'option','',label);o.value=id;}select.value=this.rangeMode;select.addEventListener('change',()=>{this.rangeMode=select.value;this.drill=null;this.savePrefs({rangeMode:this.rangeMode});this.render();});if(this.rangeMode==='year')this.yearControl(controls,entries);
      const today=localKey(new Date());
      if(this.rangeMode==='custom'){const tools=el(root,'div','ji-date-range');for(const [key,label] of [['start','From'],['end','Through']]){const lab=el(tools,'label','ji-date-label');el(lab,'span','',label);const input=el(lab,'input','ji-input');input.type='date';input.max=today;input.value=this.customRange[key]||'';input.addEventListener('change',()=>{this.customRange[key]=input.value;this.savePrefs({customRange:this.customRange});});}button(tools,'Apply dates',()=>{this.drill=null;this.render();},'ji-button');}
      const range=rangeFor(entries,this.rangeMode,Number(this.year),today,this.customRange);if(range.error){el(root,'p','ji-warning',range.error);return;}
      const d=analyze(entries,range,aggregateDays,today);el(root,'p','ji-period-caption',fd(range.start,{month:'short',day:'numeric',year:'numeric'})+' – '+fd(range.end,{month:'short',day:'numeric',year:'numeric'})+' · '+n(range.days)+' calendar days');
      this.renderRatings(root,entries,range,today);this.renderWheel(root,range,today);
      const grid=el(root,'div','ji-stats ji-insight-stats');
      this.metric(grid,n(d.data.words),'Words written','Longest daily version per date');this.metric(grid,n(d.data.active.length),'Writing days','Unique dates with text');this.metric(grid,d.rate+'%','Consistency',n(d.data.active.length)+' of '+n(range.days)+' calendar days');this.metric(grid,n(d.average),'Words / writing day','Mean across active days');
      const secondary=el(root,'details','ji-more-metrics');secondary.open=true;el(secondary,'summary','','More about this period');const extra=el(secondary,'div','ji-stats ji-secondary-stats');
      this.metric(extra,n(d.median),'Median day','Middle active-day word count');this.metric(extra,n(d.perCalendar),'Words / calendar day','Includes days without writing');this.metric(extra,n(d.data.longest),'Longest writing streak','Text days within the selected period');this.metric(extra,n(d.top[0]?d.top[0].words:0),'Longest day',d.top[0]?d.top[0].date:'No writing yet');this.metric(extra,n(d.records.filter(e=>e.words>0).length),'Nonempty files','Includes Daily conflict versions');this.metric(extra,n(metrics.journalStreak(aggregateDays(entries.filter(e=>e.date&&e.date<=today)).days,today).current),'Current journal streak','All time; text or linked images, through today or yesterday');
      const compare=el(root,'div','ji-comparison');const delta=d.data.words-d.prev.words;el(compare,'strong','',d.prev.words?(delta>=0?'+':'')+n(Math.round(delta/d.prev.words*100))+'% words':'No percentage baseline');el(compare,'span','ji-muted',n(d.data.words)+' vs '+n(d.prev.words)+' words · previous '+n(range.days)+' days ('+d.previous.start+' – '+d.previous.end+'). Missing dates count as no recorded writing.');
      this.renderDrill(root);
      if(!d.data.active.length)el(root,'p','ji-empty','No writing in this period. Choose another date range.');
      const charts=el(root,'div','ji-charts');
      const trend=d.weeks.length<=110?d.weeks:d.monthly;
      this.lineChart(charts,trend===d.weeks?'Weekly writing rhythm':'Monthly writing rhythm',trend,trend===d.weeks?'Weeks start on Monday. Boundary weeks may be partial; empty weeks remain visible.':'Boundary months may be partial; empty months remain visible.',entries);
      this.barChart(charts,'Words by month',d.monthly,'words','Estimated words by month.',entries);
      this.barChart(charts,'Writing consistency',d.monthly.map(m=>({...m,value:m.rate})),'%','Writing days divided by elapsed calendar days in each month. Fixed 0–100% scale.',entries,100);
      this.barChart(charts,'Writing days by weekday',d.weekdays,'%','Share of each weekday with writing; this adjusts for unequal weekday counts.',entries,100);
      this.barChart(charts,'Daily writing length',d.bins,'days','Distribution of combined words per active day. Zero-word days are excluded.',entries);
      let accumulatedDates=[];const cumulative=d.monthly.map(m=>{accumulatedDates=accumulatedDates.concat(m.dates);return {...m,value:m.cumulative,dates:[...accumulatedDates]};});
      this.lineChart(charts,'Your story, accumulating',cumulative,'Cumulative words from the start of this selected period. This measures recorded writing, not wellbeing.',entries);
      this.barChart(charts,'Most-written days',d.top.map(x=>({label:x.date,value:x.words,dates:[x.date]})),'words','The five longest days in this period. Select a bar to revisit the source entries.',entries);
      this.barChart(charts,'Words by year · All time',d.yearly,'words','All-time context, independent of the period above. Current year is partial.',entries);
      const method=el(root,'details','ji-method');el(method,'summary','','How these numbers are calculated');el(method,'p','ji-muted','Words are estimates after removing common template controls, frontmatter, code, and images. Conflicting daily files use the longest version per date. A writing day has at least one word. No writing time, mood, or wellbeing is inferred. Future-dated and undated files are excluded from analytics.');el(method,'p','ji-muted',n(d.data.conflicts)+' Daily dates with multiple files in this period · '+n(d.undated)+' undated files · '+n(d.future)+' future-dated files. Source-file counts include conflict versions.');
    }
  };
  Object.assign(JournalView.prototype,methods);
}
module.exports={install,rangeFor,analyze,keyDay,dayKey,shift,span,heatValue,levelFor,memoryEligible};

return module.exports;})();
const insightsModule = (()=>{const module={exports:{}};
'use strict';
function install(JournalView,{el,button,formatNumber:n,formatDate:fd,localKey,metrics:m}){
  const format=v=>v===null||v===undefined?'—':n(Math.round(v*10)/10);
  const svgNode=(parent,tag,attrs,text)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs||{}))node.setAttribute(key,value);if(text!==undefined)node.textContent=text;parent.appendChild(node);return node;};
  const methods={
    ratingBars(root,title,items,max,unit,entries,description){
      const panel=el(root,'section','ji-panel ji-chart-panel');this.title(panel,'',title);const chart=el(panel,'div','ji-bar-chart');chart.setAttribute('aria-label',title);
      for(const item of items){const dates=new Set(item.dates||[]),found=entries.filter(e=>dates.has(e.date));const row=button(chart,'',()=>this.explore(title+' · '+item.label,found),'ji-bar-row ji-bar-button');row.disabled=!found.length;row.setAttribute('aria-label',item.label+': '+format(item.value)+' '+unit+(item.sample?' from '+item.sample+' days':'')+(found.length?'. Explore entries.':'.'));el(row,'span','ji-bar-label',item.label);const track=el(row,'span','ji-bar-track'),bar=el(track,'span','ji-bar');bar.style.width=(Math.max(0,item.value)/Math.max(1,max)*100)+'%';el(row,'span','ji-bar-value',format(item.value));}
      el(panel,'p','ji-chart-unit','0 - '+format(max)+' '+unit);
      const details=el(panel,'details','ji-chart-details');el(details,'summary','','View data');el(details,'p','ji-chart-description',description);const table=el(details,'table','ji-table'),head=el(table,'thead'),hr=el(head,'tr');for(const label of ['Period / group',unit,'Rated days','Entries']){const th=el(hr,'th','',label);th.setAttribute('scope','col');}const body=el(table,'tbody');for(const item of items){const tr=el(body,'tr');el(tr,'td','',item.label);el(tr,'td','',format(item.value));el(tr,'td','',n(item.sample??item.dates?.length??0));const td=el(tr,'td'),dates=new Set(item.dates||[]),found=entries.filter(e=>dates.has(e.date));if(found.length)button(td,'Explore',()=>this.explore(title+' · '+item.label,found),'ji-link');else el(td,'span','ji-muted','—');}
    },
    renderRatings(root,entries,range,today){
      const result=m.ratings(entries,range,today),section=el(root,'section','ji-insight-group');this.title(section,'','Daily ratings');
      if(!result.data.length){el(section,'p','ji-empty','No unambiguous daily ratings in this period.');if(result.conflicts.length){const rows=result.conflicts.flatMap(x=>x.records);button(section,'View conflicting ratings',()=>this.explore('Conflicting ratings',rows),'ji-button');}return;}
      const grid=el(section,'div','ji-stats ji-score-stats'),last=result.data[result.data.length-1];this.metric(grid,format(result.average)+' / 10','Average rating','Average of unambiguous daily scores');this.metric(grid,n(result.data.length),'Rated days','One saved score per date');this.metric(grid,format(last.value)+' / 10','Latest rating',fd(last.date));this.metric(grid,(Math.round(result.data.length/range.days*1000)/10)+'%','Rating coverage','Rated days divided by calendar days in the selected range');
      if(result.conflicts.length){const conflictEntries=result.conflicts.flatMap(x=>x.records);const warning=el(section,'p','ji-warning',n(result.conflicts.length)+' dates have conflicting ratings and are excluded. ');button(warning,'View entries',()=>this.explore('Conflicting ratings',conflictEntries),'ji-link');}
      const charts=el(section,'div','ji-charts');this.ratingBars(charts,'Average rating by month',result.monthly,10,'score / 10',entries,'Mean of saved 1–10 scores for each month; dates with conflicting scores are excluded. Months with no scores are omitted.');
      this.ratingBars(charts,'Rating distribution',result.distribution,Math.max(1,...result.distribution.map(x=>x.value)),'days',entries,'Number of rated dates at each score. Decimal scores, if present, are grouped into the displayed ranges.');
      const info=el(section,'details','ji-method');el(info,'summary','','About ratings');el(info,'p','ji-muted','A saved 1–10 value counts as a rating, including 1. Some templates may save a default value; the plugin cannot determine whether a value was intentional. Missing, out-of-range, and conflicting values are not counted.');
    },
    wheelRadar(root,summary){
      const svg=svgNode(root,'svg',{viewBox:'0 0 440 380',class:'ji-wheel-svg',role:'img','aria-label':'Wheel of Life averages. '+summary.map(c=>c.label+': '+(c.value===null?'no data':format(c.value)+' out of 10')).join('; ')});
      const cx=220,cy=190,r=112,point=(i,value,scale=1)=>{const a=-Math.PI/2+i*Math.PI/4;return [cx+Math.cos(a)*r*value/10*scale,cy+Math.sin(a)*r*value/10*scale]};
      for(const step of [2,4,6,8,10])svgNode(svg,'circle',{cx,cy,r:r*step/10,class:'ji-wheel-grid'});
      summary.forEach((cat,i)=>{const [x,y]=point(i,10);svgNode(svg,'line',{x1:cx,y1:cy,x2:x,y2:y,class:'ji-wheel-axis'});const [lx,ly]=point(i,10,1.25),anchor=lx<cx-8?'end':lx>cx+8?'start':'middle';svgNode(svg,'text',{x:lx,y:ly+4,'text-anchor':anchor,class:'ji-wheel-label'},cat.label);});
      if(summary.every(c=>c.value!==null)){const points=summary.map((c,i)=>point(i,c.value).map(x=>x.toFixed(1)).join(',')).join(' ');svgNode(svg,'polygon',{points,class:'ji-wheel-polygon'});}
      summary.forEach((cat,i)=>{if(cat.value===null)return;const [x,y]=point(i,cat.value),p=svgNode(svg,'circle',{cx:x,cy:y,r:4,class:'ji-wheel-point'});svgNode(p,'title',{},cat.label+': '+format(cat.value)+' / 10 · '+n(cat.count)+' weeks');});
    },
    wheelTrend(root,items,period,category){
      const panel=el(root,'section','ji-panel ji-chart-panel ji-chart-wide');this.title(panel,'','Wheel of Life over time');
      const data=items.filter(x=>x.value!==null);if(!data.length){el(panel,'p','ji-empty','No scores for this category in this period.');return;}
      const W=620,H=220,L=44,R=20,T=15,B=35,svg=svgNode(panel,'svg',{viewBox:'0 0 '+W+' '+H,class:'ji-line-chart',role:'img','aria-label':category+' Wheel of Life trend, '+period+'. Exact values and source notes are in View data.'});
      const y=v=>H-B-v/10*(H-T-B),starts=items.map(x=>m.dayNumber(x.start)),min=starts[0],max=starts[starts.length-1],x=(v)=>L+(max===min?(W-L-R)/2:(v-min)/(max-min)*(W-L-R));
      for(const tick of [0,5,10]){svgNode(svg,'line',{x1:L,x2:W-R,y1:y(tick),y2:y(tick),class:'ji-chart-gridline'});svgNode(svg,'text',{x:L-8,y:y(tick)+4,'text-anchor':'end',class:'ji-axis-text'},String(tick));}
      const adjacent=(a,b)=>{if(period==='weekly')return m.dayNumber(b.start)-m.dayNumber(a.start)===7;if(period==='yearly')return Number(b.label)-Number(a.label)===1;const aY=Number(a.start.slice(0,4)),bY=Number(b.start.slice(0,4)),aM=Number(a.start.slice(5,7)),bM=Number(b.start.slice(5,7));return (bY-aY)*12+bM-aM===(period==='quarterly'?3:1);};
      let run=[];const flush=()=>{if(run.length>1)svgNode(svg,'polyline',{points:run.map(p=>x(m.dayNumber(p.start))+','+y(p.value)).join(' '),class:'ji-chart-line'});run=[];};
      for(const item of items){if(item.value===null){flush();continue;}if(run.length&&!adjacent(run[run.length-1],item))flush();run.push(item);const c=svgNode(svg,'circle',{cx:x(m.dayNumber(item.start)),cy:y(item.value),r:3.5,class:'ji-wheel-point'});svgNode(c,'title',{},item.label+': '+format(item.value)+' / 10 · '+n(item.count)+' weeks');}flush();
      for(const i of [...new Set([0,Math.floor((items.length-1)/2),items.length-1])])svgNode(svg,'text',{x:x(starts[i]),y:H-10,'text-anchor':i===0?'start':i===items.length-1?'end':'middle',class:'ji-axis-text'},items[i].label);
      const details=el(panel,'details','ji-chart-details');el(details,'summary','','View data');const table=el(details,'table','ji-table'),head=el(table,'thead'),hr=el(head,'tr');for(const label of ['Period','Score / 10','Scored weeks','Source notes']){const th=el(hr,'th','',label);th.setAttribute('scope','col');}const tbody=el(table,'tbody');
      for(const item of items){const tr=el(tbody,'tr');el(tr,'td','',item.label);el(tr,'td','',format(item.value));el(tr,'td','',n(item.count));const cell=el(tr,'td'),records=item.weeks.flatMap(w=>w.records.map(row=>({label:w.label,file:row.file})));if(records.length){const group=el(cell,'details','ji-source-notes');el(group,'summary','',n(records.length)+' notes');for(const record of records)button(group,record.label,()=>this.app.workspace.getLeaf('tab').openFile(record.file),'ji-link');}else el(cell,'span','ji-muted','—');}
    },
    renderWheel(root,range,today){
      const section=el(root,'section','ji-insight-group');this.title(section,'','Wheel of Life');const weeks=m.selectedWeeks(m.weekly(this.weekEntries||[]),range,today),summary=m.wheelSummary(weeks),scored=weeks.filter(w=>Object.values(w.values).some(v=>v!==null));
      if(!scored.length){el(section,'p','ji-empty','No valid weekly Wheel of Life scores in this period.');return;}
      el(section,'p','ji-period-caption','Average across '+n(scored.length)+' weekly '+(scored.length===1?'note':'notes')+' with scores.');
      const layout=el(section,'div','ji-wheel-layout'),visual=el(layout,'div','ji-panel ji-wheel-visual');this.wheelRadar(visual,summary);const list=el(layout,'div','ji-panel ji-wheel-scores');
      for(const cat of summary){const row=el(list,'div','ji-wheel-score');el(row,'span','ji-wheel-score-label',cat.label);const track=el(row,'span','ji-bar-track');if(cat.value!==null){const bar=el(track,'span','ji-bar');bar.style.width=(cat.value/10*100)+'%';}const v=el(row,'span','ji-wheel-score-value',format(cat.value));v.title=n(cat.count)+' weeks';row.setAttribute('aria-label',cat.label+': '+(cat.value===null?'No data':format(cat.value)+' out of 10, '+n(cat.count)+' weeks'));}
      const conflicts=weeks.reduce((s,w)=>s+w.conflicts,0);if(conflicts)el(section,'p','ji-warning',n(conflicts)+' conflicting weekly category scores are excluded.');
      const controls=el(section,'div','ji-wheel-controls'),period=el(controls,'select','ji-select');period.setAttribute('aria-label','Wheel of Life grouping');for(const [id,label] of [['weekly','Weekly'],['monthly','Monthly'],['quarterly','Quarterly'],['yearly','Yearly']]){const o=el(period,'option','',label);o.value=id;}period.value=this.wheelPeriod||'monthly';period.addEventListener('change',()=>{this.wheelPeriod=period.value;this.render();});
      const category=el(controls,'select','ji-select');category.setAttribute('aria-label','Wheel of Life category');for(const cat of m.CATEGORIES){const o=el(category,'option','',cat.label);o.value=cat.key;}this.wheelCategory=this.wheelCategory||summary.find(x=>x.value!==null)?.key||m.CATEGORIES[0].key;category.value=this.wheelCategory;category.addEventListener('change',()=>{this.wheelCategory=category.value;this.render();});
      this.wheelTrend(section,m.wheelTimeline(weeks,this.wheelPeriod||'monthly',this.wheelCategory),this.wheelPeriod||'monthly',m.CATEGORIES.find(x=>x.key===this.wheelCategory)?.label||'Score');
      const info=el(section,'details','ji-method');el(info,'summary','','About Wheel of Life');el(info,'p','ji-muted','Scores are read from weekly note properties. Each category is averaged only across weeks with a valid 1–10 value; missing values are not zeros. Duplicate weeks with conflicting values are excluded for that category. Weeks are assigned to dates by their Thursday, so they are counted once across months, quarters and years. If the selected period ends today, the current unfinished week is also included when it has scores.');
    }
  };Object.assign(JournalView.prototype,methods);
}
module.exports={install};

return module.exports;})();

const VIEW = 'journal-insights-view';
const JOURNAL_FOLDERS = {
  daily: 'dailyFolder', weekly: 'weeklyFolder', monthly: 'monthlyFolder',
  quarterly: 'quarterlyFolder', yearly: 'yearlyFolder'
};
const DEFAULTS = {
  dailyFolder: '01 Daily', weeklyFolder: '02 Weekly', monthlyFolder: '03 Monthly',
  quarterlyFolder: '04 Quarterly', yearlyFolder: '05 Yearly'
};
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function validDate(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  const dt = new Date(y, m - 1, d, 12);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
    ? `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` : null;
}
function localKey(dt) { return validDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); }
function dateFromFile(file, fm = {}) {
  const byName = file.basename.match(/^(\d{4})-(\d{2})-(\d{2})(?:\b|[-_])/);
  if (byName) return validDate(byName[1], byName[2], byName[3]);
  for (const value of [fm['journal-date'], fm.date]) {
    if (value instanceof Date && !isNaN(value)) return localKey(value);
    const hit = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (hit) { const v = validDate(hit[1], hit[2], hit[3]); if (v) return v; }
  }
  const human = file.basename.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (human) return validDate(human[3], MONTHS.findIndex(x => x.toLowerCase() === human[1].toLowerCase()) + 1, human[2]);
  return null;
}
function underFolder(path, folder) {
  folder = (folder || '').trim().replace(/^\/+|\/+$/g, '');
  return !!folder && (path.startsWith(folder + '/'));
}
function extractImage(text) {
  const embed = text.match(/!\[\[([^\]|#]+\.(?:png|jpe?g|webp|gif|avif))(?:[|#][^\]]*)?\]\]/i);
  if (embed) return embed[1].trim();
  const md = text.match(/!\[[^\]]*\]\(([^\s)]+\.(?:png|jpe?g|webp|gif|avif))(?:\s+[^)]*)?\)/i);
  return md && !/^(?:https?:|data:|\/\/)/i.test(md[1]) ? decodeURIComponentSafe(md[1]) : null;
}
function decodeURIComponentSafe(v) { try { return decodeURIComponent(v); } catch { return v; } }
function cleanText(input) {
  if (input.length < 500 && /(?:B\?n nh\?p tr\?ng|Bản nháp trống)/i.test(input) && /iCloud/i.test(input)) return '';
  let t = input.replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '');
  t = t.replace(/^[ \t]*(?:>[ \t]*)?(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*(?:>[ \t]*)?\1[ \t]*$/gm, ' ');
  t = t.replace(/<%[\s\S]*?%>/g, ' ').replace(/<p\s+hidden[^>]*>[\s\S]*?<\/p>/gi, ' ');
  t = t.replace(/!\[\[[^\]]+\]\]/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  t = t.replace(/^\s*>\s*\[!\s*journal\][^\n]*$/gim, ' ');
  t = t.replace(/^\s*\[\[A secret garden within the garden\.\]\]\s*$/gim, ' ');
  t = t.replace(/^\s*`?BUTTON\[[^\]]*\]`?\s*$/gim, ' ');
  t = t.replace(/^\s*\[\[[^\]]*\|\s*\]\]\s*$/gm, ' ');
  t = t.replace(/^\s*#{1,6}\s*(?:[^\n]*\b(?:Pictures|Quick Notes|Q&A|PicturesEnd)\b[^\n]*)$/gim, ' ');
  t = t.replace(/^\s*#{1,6}\s*(?:Nhật ký|Điểm nhấn|Điều cần điều chỉnh)\s*$/gim, ' ');
  t = t.replace(/^\s*#\s*[^\n]*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}[^\n]*$/gim, ' ');
  t = t.replace(/^\s*(?:[-*_]\s*){3,}$/gm, ' ');
  t = t.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target, label) => label === '' ? ' ' : (label || target));
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/<[^>]+>/g, ' ');
  t = t.replace(/^\s*#{1,6}\s*/gm, '').replace(/^\s*>\s?/gm, '').replace(/^\s*[-*+]\s+/gm, ' ');
  t = t.replace(/`([^`]+)`/g, '$1').replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim();
  return t;
}
function countWords(text) { return (text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []).length; }
function groupStats(entries, today = new Date()) {
  const dates = new Set(entries.filter(e => e.date && e.words > 0).map(e => e.date));
  const counts = new Map();
  for (const e of entries) if (e.date && e.words > 0) counts.set(e.date, (counts.get(e.date) || 0) + 1);
  const keys = [...dates].sort();
  let longest = 0, run = 0, previous = null;
  for (const key of keys) {
    const d = new Date(key + 'T12:00:00');
    const prev = new Date(d); prev.setDate(prev.getDate()-1);
    run = previous === localKey(prev) ? run + 1 : 1; longest = Math.max(longest, run); previous = key;
  }
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  if (!dates.has(localKey(cursor))) cursor.setDate(cursor.getDate()-1);
  let current = 0;
  while (dates.has(localKey(cursor))) { current++; cursor.setDate(cursor.getDate()-1); }
  return { dates, counts, days: dates.size, current, longest, words: entries.reduce((n,e)=>n+e.words, 0), duplicates: [...counts.values()].filter(n=>n>1).length, undated: entries.filter(e=>!e.date).length };
}

function formatNumber(n) { return new Intl.NumberFormat('en-US').format(n); }
function formatDate(key, options) {
  if (!key) return 'Unknown date';
  return new Intl.DateTimeFormat('en-US', options || { weekday:'long', month:'long', day:'numeric', year:'numeric' }).format(new Date(key+'T12:00:00'));
}
function el(parent, tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  parent.appendChild(n);
  return n;
}
function button(parent, label, fn, cls) {
  const n = el(parent,'button',cls || 'ji-button',label);
  n.type = 'button';
  n.addEventListener('click',fn);
  return n;
}
function aggregateDays(entries, today) {
  const days = new Map(), groups = new Map();
  for (const entry of entries) {
    if (!entry.date || (entry.kind && entry.kind !== 'daily')) continue;
    if (!days.has(entry.date)) days.set(entry.date,{date:entry.date,records:[],dailyMax:0,words:0});
    const day = days.get(entry.date);
    day.records.push(entry);
    day.dailyMax = Math.max(day.dailyMax,entry.words);
    day.words = day.dailyMax;
    groups.set(entry.date,(groups.get(entry.date)||0)+1);
  }
  const active = [...days.values()].filter(d=>d.words>0).sort((a,b)=>a.date.localeCompare(b.date));
  let longest=0, run=0, prior=null;
  for(const day of active) {
    const prev=new Date(day.date+'T12:00:00'); prev.setDate(prev.getDate()-1);
    run=prior===localKey(prev)?run+1:1; prior=day.date; longest=Math.max(longest,run);
  }
  const currentDay=today || new Date();
  const cursor=new Date(currentDay.getFullYear(),currentDay.getMonth(),currentDay.getDate(),12);
  if (!(days.get(localKey(cursor)) || {}).words) cursor.setDate(cursor.getDate()-1);
  let streak=0;
  while ((days.get(localKey(cursor)) || {}).words>0) { streak++; cursor.setDate(cursor.getDate()-1); }
  return {
    days, active, longest, streak,
    words:active.reduce((sum,d)=>sum+d.words,0),
    conflicts:[...groups.values()].filter(count=>count>1).length,
    undated:entries.filter(e=>(!e.kind||e.kind==='daily')&&!e.date).length
  };
}
function heatLevel(words) {
  if (!words) return 0;
  if (words<100) return 1;
  if (words<300) return 2;
  if (words<700) return 3;
  return 4;
}
function buildCharts(entries, year) {
  const data=aggregateDays(entries), active=data.active.filter(day=>day.date.startsWith(String(year)+'-'));
  const months=Array.from({length:12},(_,i)=>({label:MONTHS[i].slice(0,3),value:0}));
  const weekdays=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(label=>({label,value:0}));
  const lengths=[{label:'1-99 words',value:0},{label:'100-299 words',value:0},{label:'300-699 words',value:0},{label:'700+ words',value:0}];
  for(const day of active) {
    months[Number(day.date.slice(5,7))-1].value+=day.words;
    const weekday=(new Date(day.date+'T12:00:00').getDay()+6)%7;
    weekdays[weekday].value++;
    lengths[heatLevel(day.words)-1].value++;
  }
  const words=active.reduce((n,d)=>n+d.words,0);
  return {months,weekdays,lengths,activeDays:active.length,words,average:active.length?Math.round(words/active.length):0,longestDay:active.reduce((n,d)=>Math.max(n,d.words),0)};
}

class JournalView extends ItemView {
  constructor(leaf,plugin) {
    super(leaf); this.plugin=plugin; this.tab='home'; this.query='';
    this.year=String(new Date().getFullYear()); this.entryYear='all'; this.limit=36;
    this.generation=0; this.entries=[]; this.weekEntries=[]; this.periods=[];
    this.memoryDate=localKey(new Date()); this.selectedDay=null;
    this.scrollByTab=new Map();
  }
  getViewType(){return VIEW;}
  getDisplayText(){return 'Journal Insights';}
  getIcon(){return 'book-heart';}
  async onOpen(){this.containerEl.addClass('ji-view'); await this.refresh();}
  async onClose(){this.generation++;for(const observer of this.chartObservers||[])observer.disconnect();}
  async refresh(){
    const generation = ++this.generation;
    if (!this.indexReady && !this.contentEl.children.length) {
      el(this.contentEl, 'div', 'ji-loading', 'Reading your journal…');
    }
    try {
      const snapshot = await this.plugin.journalIndex.update();
      if (generation !== this.generation) return;
      Object.assign(this, snapshot);
      this.indexReady = true;
      this.sameDateCounts = new Map();
      const entriesByPath = new Map();
      for (const row of this.entries) {
        this.sameDateCounts.set(row.date, (this.sameDateCounts.get(row.date) || 0) + 1);
        entriesByPath.set(row.file.path, row);
      }
      if (this.drill) {
        this.drill.entries = this.drill.entries.flatMap(row => {
          const current = entriesByPath.get(row.file.path);
          return current ? [current] : [];
        });
      }
      this.render();
    } catch {
      if (generation !== this.generation) return;
      this.failed = Math.max(1, this.failed || 0);
      this.render();
    }
  }
  subset(){return this.entries;}
  title(parent,eyebrow,title,detail){
    const h=el(parent,'div','ji-section-heading');const left=el(h,'div','ji-heading-copy');
    el(left,'h2','ji-section-title',title);
    if(detail)el(h,'span','ji-muted',detail);
    return h;
  }
  statGrid(parent,stats,scope){
    const grid=el(parent,'div','ji-stats');
    const rows=[
      [formatNumber(stats.active.length),'Days written','One count per day'],
      [formatNumber(stats.words),'Words written','Estimated from journal text'],
      [formatNumber(stats.streak),'Current streak','Through today or yesterday'],
      [formatNumber(stats.longest),'Longest streak','Consecutive days']
    ];
    for(const [number,label,note] of rows){const box=el(grid,'div','ji-stat');el(box,'span','ji-stat-label',label);el(box,'strong','ji-stat-number',number);el(box,'span','ji-stat-sub',note);}
  }
  cards(root,items,compact,{query=''}={}){
    if(!items.length){el(root,'p','ji-empty','No entries to show yet.');return;}
    const grid=el(root,'div',compact?'ji-card-list':'ji-card-grid');
    for(const entry of items){
      const item=el(grid,'article','ji-card-item'+(compact?' is-compact':''));
      const card=button(item,'',()=>this.openEntry(entry),'ji-card'+(compact?' is-compact':''));
      const meta=el(card,'div','ji-card-meta');el(meta,'span','',formatNumber(entry.words)+' words');if(entry.rating!==null&&entry.rating!==undefined)el(meta,'span','','Rating '+formatNumber(entry.rating)+' / 10');
      el(card,'h3','ji-card-date',formatDate(entry.date));
      const preview=el(card,'p','ji-card-preview');
      if(entry.text){
        const parts=searchModule.excerpt(entry.text,entry.searchText?.includes(query)?query:'');
        preview.append(parts.before);
        if(parts.match)el(preview,'mark','ji-search-match',parts.match);
        preview.append(parts.after);
      }else preview.textContent='No text to preview yet.';
      if(entry.date&&(this.sameDateCounts.get(entry.date)||0)>1)el(card,'span','ji-conflict','Multiple entries on this date');
      if(this.plugin.photoController&&this.plugin.settings.experience?.showPhotoPreviews!==false)this.plugin.photoController.gallery(item,entry.photos,entry.file.path,{limit:3,className:'ji-card-photos'});
      if(!compact)this.renderEntryActions(item,entry);
    }
  }
  renderCalendar(root,entries,stats){
    const h=this.title(root,'','Calendar');this.yearControl(h,entries);
    this.heatmap(root,stats,Number(this.year));
    this.dayRegion=el(root,'div','ji-day-results');
    if(this.selectedDay&&this.selectedDay.startsWith(this.year))this.showDay(this.selectedDay,false);
    else el(this.dayRegion,'p','ji-empty','Select a date.');
  }
  showDay(key,scroll){
    if(!this.dayRegion)return;this.dayRegion.empty();
    const entries=this.subset().filter(e=>e.date===key);
    this.title(this.dayRegion,'',formatDate(key),formatNumber(entries.length)+' '+(entries.length===1?'entry':'entries'));
    this.cards(this.dayRegion,entries,false);
    if(scroll&&this.dayRegion.scrollIntoView)this.dayRegion.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

}

const BANNER_TEMPLATES = new Set([
  '06 Templates/Components/Daily Banner Config.md',
  '06 Templates/Components/Weekly Banner Config.md',
  '06 Templates/Components/Monthly Banner Config.md',
  '06 Templates/Components/Quarterly Banner Config.md',
  '06 Templates/Components/Yearly Banner Config.md'
]);
const JOURNAL_ROOTS=['00 Dashboard/','01 Daily/','02 Weekly/','03 Monthly/','04 Quarterly/','05 Yearly/'];
function normalizedBannerValue(raw){
  let value=raw.trim();
  if(!value||value.includes('#')||value.includes('{')||value.includes('}'))return null;
  if(value.startsWith('"')&&value.endsWith('"')){try{value=JSON.parse(value);}catch(error){return null;}}
  else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1).replace(/''/g,"'");
  if(typeof value!=='string')return null;
  value=value.trim();
  const match=value.match(/^!?\[\[([^\]\r\n]+)\]\]$/);
  if(match)value=match[1];
  if(!/\.(?:avif|gif|png|jpe?g|webp|bmp|svg)$/i.test(value))return null;
  return '[['+value+']]';
}
function repairBanner(text,isTemplate){
  if(isTemplate){
    let count=0;
    const result=text.replace(/(\bbanner:)[ \t]*\r?\n[ \t]*-[ \t]*-[ \t]*([^\r\n]+)(\r?\n)/g,(all,prefix,value,newline)=>{
      if(!value.includes('\${'))return all;
      count++;return prefix+' "[['+value.trim()+']]"'+newline;
    });
    return {text:result,changed:count>0,kind:'template'};
  }
  const fm=text.match(/^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/);
  if(!fm)return {text,changed:false};
  const front=fm[2], newline=front.includes('\r\n')?'\r\n':'\n';
  const nested=front.match(/^banner:[ \t]*\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))+)/m);
  let updated=front,legacy=false;
  if(nested){
    const lines=nested[1].split(/\r?\n/).filter(line=>line.trim());
    const values=[];
    for(const line of lines){
      const match=line.match(/^[ \t]*-[ \t]*-[ \t]*(.+?)[ \t]*$/);
      if(!match)return {text,changed:false,reason:'unsupported-banner-list'};
      const value=normalizedBannerValue(match[1]);if(!value)return {text,changed:false,reason:'unsupported-banner-value'};
      values.push(value);
    }
    if(!values.length)return {text,changed:false};
    const unique=[...new Set(values)];
    if(unique.length>1&&/^journal-insights-legacy-banners:/m.test(front))return {text,changed:false,reason:'legacy-field-exists'};
    let replacement='banner: '+JSON.stringify(values[0])+newline;
    if(unique.length>1){replacement+='journal-insights-legacy-banners: '+JSON.stringify(values)+newline;legacy=true;}
    updated=front.replace(nested[0],replacement);
  }else{
    const raw=front.match(/^banner:[ \t]*(!?\[\[[^\r\n]+?\]\])[ \t]*$/m);
    if(raw)updated=front.replace(raw[0],'banner: '+JSON.stringify(raw[1].replace(/^!/,'') ));
  }
  if(updated===front)return {text,changed:false};
  return {text:fm[1]+updated+fm[3]+text.slice(fm[0].length),changed:true,kind:'note',legacy};
}
class JournalSettings extends PluginSettingTab {
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){
    const c=this.containerEl;c.empty();el(c,'h2','','Journal Insights');
    new Setting(c).setName('Open at startup').setDesc('Show Journal Insights after Obsidian restores the workspace.').addToggle(t=>t.setValue(this.plugin.settings.openOnStartup).onChange(async value=>{this.plugin.settings.openOnStartup=value;await this.plugin.saveSettings();}));
    new Setting(c).setName('Daily folder').setDesc('Folder path relative to the vault.').addText(t=>t.setValue(this.plugin.settings.dailyFolder).onChange(async value=>{this.plugin.settings.dailyFolder=value.trim().replace(/^\/+|\/+$/g,'');await this.plugin.saveSettings();this.plugin.reindexFolders();}));
    new Setting(c).setName('Weekly folder').setDesc('Folder containing Wheel of Life weekly notes.').addText(t=>t.setValue(this.plugin.settings.weeklyFolder).onChange(async value=>{this.plugin.settings.weeklyFolder=value.trim().replace(/^\/+|\/+$/g,'');await this.plugin.saveSettings();this.plugin.reindexFolders();}));
    new Setting(c).setName('Repair Pixel Banner properties').setDesc('Backs up affected notes and fixes legacy banner formatting.').addButton(b=>b.setButtonText('Repair banners').onClick(()=>this.plugin.repairBanners()));
    el(c,'p','ji-settings-note','Analytics use estimated words. Conflicting Daily versions are counted once per date using the longest version.');
  }
}
class JournalInsights extends Plugin {
  async onload(){
    const stored=await this.loadData()||{};
    const migrated=Object.prototype.hasOwnProperty.call(stored,'dreamFolder')||!!(stored.experience&&Object.prototype.hasOwnProperty.call(stored.experience,'kind'));
    // Retire the old options without deleting hidden-entry preferences or touching notes.
    const {dreamFolder:retiredFolder,...compatible}=stored;
    if(compatible.experience){const {kind:retiredKind,...experience}=compatible.experience;compatible.experience=experience;}
    this.settings=Object.assign({},DEFAULTS,{openOnStartup:true},compatible);
    if(migrated){try{await this.saveSettings();}catch(error){console.error('Journal Insights settings migration failed',error);new Notice('Could not update old Journal Insights settings.');}}
    this.journalIndex = new indexModule.JournalIndex({
      list: () => this.app.vault.getMarkdownFiles(),
      classify: path => this.journalKind(path),
      load: (file, kind, data, metadata) => this.indexNote(file, kind, data, metadata)
    });
    this.photoController=photoModule.makeController(this,{Modal,TFile,el,button});
    galleryModule.registerNoteGalleries(this,{photos:photoModule,TFile,editorInfoField,editorLivePreviewField,Notice});
    this.registerView(VIEW,leaf=>new JournalView(leaf,this));
    this.addRibbonIcon('book-heart','Open Journal Insights',()=>this.activateView());
    this.addCommand({id:'open-journal-insights',name:'Open Journal Insights',callback:()=>this.activateView()});
    this.addCommand({id:'repair-pixel-banner-properties',name:'Repair Pixel Banner properties',callback:()=>this.repairBanners()});
    this.addCommand({id:'clean-empty-daily-sections',name:'Clean empty Daily sections',callback:()=>this.cleanupDailySections()});
    this.addCommand({id:'journal-check',name:'Open Journal Check',callback:async()=>{
      const view=await this.activateView();
      view.navigate('check');
    }});
    this.addCommand({id:'journal-periods',name:'Show journal periods for current note',checkCallback:checking=>{
      const file=this.app.workspace.getActiveFile();
      const available=file instanceof TFile&&Boolean(this.journalKind(file.path));
      if(available&&!checking)this.showPeriodsFor(file);
      return available;
    }});
    this.addSettingTab(new JournalSettings(this.app,this));
    const isImage=path=>/\.(?:png|jpe?g|gif|webp|avif|svg|bmp|heic|heif|tiff?)$/i.test(path);
    const changed=file=>{
      if(file instanceof TFile&&(this.journalIndex.invalidate(file)||isImage(file.path)))this.scheduleRefresh();
    };
    const vault=this.app.vault,metadata=this.app.metadataCache;
    this.registerEvent(vault.on('create',changed));
    this.registerEvent(vault.on('modify',changed));
    this.registerEvent(vault.on('delete',file=>{
      if(file instanceof TFile){
        if(this.journalIndex.forget(file.path)||isImage(file.path))this.scheduleRefresh();
      }else if(Array.isArray(file.children)){
        if(this.journalFolderAffected(file.path))this.journalIndex.requestScan();
        this.scheduleRefresh();
      }
    }));
    this.registerEvent(vault.on('rename',(file,oldPath)=>{
      if(file instanceof TFile){
        const removed=this.journalIndex.forget(oldPath);
        const added=this.journalIndex.invalidate(file);
        if(removed||added||isImage(oldPath)||isImage(file.path))this.scheduleRefresh();
        if(removed||added)this.remapNotePrefs(oldPath,file.path);
      }else if(Array.isArray(file.children)){
        if(this.journalFolderAffected(oldPath)||this.journalFolderAffected(file.path)){
          this.journalIndex.requestScan();
        }
        this.remapNotePrefs(oldPath,file.path,true);
        this.scheduleRefresh();
      }
    }));
    this.registerEvent(metadata.on('changed',(file,data,cache)=>{
      const hasView=this.app.workspace.getLeavesOfType(VIEW).length>0;
      if(this.journalIndex.invalidate(file,hasView?data:undefined,cache))this.scheduleRefresh();
    }));
    this.registerEvent(metadata.on('resolved',()=>{
      if(this.initialMetadataResolved)return;
      this.initialMetadataResolved=true;
      this.scheduleRefresh();
    }));
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file)=>{
      if(file instanceof TFile&&this.journalKind(file.path)){
        menu.addItem(item=>item.setTitle('Journal periods').setIcon('calendar-range').onClick(()=>this.showPeriodsFor(file)));
      }
    }));
    this.app.workspace.onLayoutReady(()=>{if(this.settings.openOnStartup)this.activateView();});
  }
  onunload(){clearTimeout(this.refreshTimer);}
  journalKind(path){
    if(!/\.md$/i.test(path))return null;
    let kind=null,depth=-1;
    for(const [candidate,key] of Object.entries(JOURNAL_FOLDERS)){
      const folder=this.settings[key];
      if(typeof folder==='string'&&folder.length>depth&&underFolder(path,folder)){
        depth=folder.length;
        kind=candidate;
      }
    }
    return kind;
  }
  journalFolderAffected(path){
    return Object.values(JOURNAL_FOLDERS).some(key=>{
      const folder=this.settings[key];
      return folder===path||underFolder(path,folder)||underFolder(folder||'',path);
    });
  }
  async indexNote(file,kind,data,metadata){
    if(kind!=='daily'){
      const properties=(metadata||this.app.metadataCache.getFileCache(file))?.frontmatter||{};
      const period=reviewModule.readPeriod(file,kind,properties,metricsModule);
      return {period,wheel:kind==='weekly'?properties.wheelOfLife||null:null};
    }
    const raw=typeof data==='string'?data:await this.app.vault.cachedRead(file);
    const properties=(metadata||this.app.metadataCache.getFileCache(file))?.frontmatter||{};
    const text=cleanText(raw);
    return {
      date:dateFromFile(file,properties),text,searchText:searchModule.fold(text),
      words:countWords(text),rating:metricsModule.score(properties.dayRating),
      photos:photoModule.parsePhotos(raw),
      private:properties.private===true||properties['journal-insights-hide']===true
    };
  }
  scheduleRefresh(){
    clearTimeout(this.refreshTimer);
    if(!this.app.workspace.getLeavesOfType(VIEW).length)return;
    this.refreshTimer=setTimeout(()=>this.refreshViews(),350);
  }
  refreshViews(){
    return Promise.all(this.app.workspace.getLeavesOfType(VIEW).map(leaf=>leaf.view.refresh()));
  }
  reindexFolders(){
    this.journalIndex.requestScan();
    return this.refreshViews();
  }
  async remapNotePrefs(oldPath,newPath,includeChildren=false){
    const before=this.settings.experience;
    if(!before)return;
    const remapped={...before};
    for(const key of ['excluded','savedMemories']){
      if(!Array.isArray(before[key]))continue;
      remapped[key]=toolsModule.remapPaths(before[key],oldPath,newPath,includeChildren);
    }
    if(JSON.stringify(remapped)===JSON.stringify(before))return;
    this.settings.experience=remapped;
    try{await this.saveSettings();}catch{
      new Notice('Could not save updated journal note paths.');
    }
  }
  async showPeriodsFor(file){
    const view=await this.activateView();
    await view.showPeriods(file);
  }
  async saveSettings(){
    // Serialize writes so fast changes in different sections cannot race on disk.
    const snapshot=JSON.parse(JSON.stringify(this.settings));
    const previous=this.settingsWriteQueue||Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>this.saveData(snapshot));
    this.settingsWriteQueue=next;
    return next;
  }
  async activateView(){
    let leaf=this.app.workspace.getLeavesOfType(VIEW)[0];
    if(!leaf){leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:VIEW,active:true});}
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view;
  }
  async cleanupDailySections(){return cleanupModule.run(this,{mask:photoModule.maskNonContent,Notice,TFile});}
  async repairBanners(){
    if(this.repairRunning){new Notice('Banner repair is already running.');return;}
    this.repairRunning=true;new Notice('Checking Pixel Banner properties...');
    try{
      const candidates=this.app.vault.getMarkdownFiles().filter(f=>BANNER_TEMPLATES.has(f.path)||JOURNAL_ROOTS.some(root=>f.path.startsWith(root)));
      const pending=[],unsupported=[];let failed=0;
      for(const file of candidates){
        try{
          const before=await this.app.vault.read(file),result=repairBanner(before,BANNER_TEMPLATES.has(file.path));
          if(result.changed)pending.push({file,before,after:result.text,kind:result.kind,legacy:!!result.legacy});
          else if(result.reason)unsupported.push({path:file.path,reason:result.reason});
        }catch(error){failed++;}
      }
      if(!pending.length){new Notice('Banner check complete. No supported properties need changes.');return;}
      const adapter=this.app.vault.adapter,base='.archive',stamp=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,17),dir=base+'/journal-insights-banner-repair-'+stamp;
      if(!await adapter.exists(base))await adapter.mkdir(base);
      if(await adapter.exists(dir))throw new Error('Backup directory already exists.');
      await adapter.mkdir(dir);
      const backup=JSON.stringify({created:new Date().toISOString(),files:pending.map(item=>({path:item.file.path,text:item.before}))});
      await adapter.write(dir+'/before.json',backup);
      if(await adapter.read(dir+'/before.json')!==backup)throw new Error('Backup verification failed.');
      let updated=0,concurrent=0,legacy=0,templates=0;
      for(let i=0;i<pending.length;i++){
        const item=pending[i];let changed=false;
        try{
          await this.app.vault.process(item.file,current=>{
            if(current!==item.before){concurrent++;return current;}
            changed=true;return item.after;
          });
          if(changed){updated++;if(item.legacy)legacy++;if(item.kind==='template')templates++;}
        }catch(error){failed++;}
        if(i%20===19)await new Promise(resolve=>setTimeout(resolve,10));
      }
      const report={finished:new Date().toISOString(),checked:candidates.length,updated,templates,legacy,concurrent,failed,unsupported,backup:dir+'/before.json'};
      await adapter.write(dir+'/report.json',JSON.stringify(report,null,2));
      new Notice('Banner repair complete: '+updated+' updated, '+concurrent+' changed during repair, '+failed+' failed. Backup: '+dir,15000);
    }catch(error){
      console.error('Journal Insights banner repair failed',error);
      new Notice('Banner repair could not finish. Check the console for details.',15000);
    }finally{this.repairRunning=false;}
  }
}
const viewHelpers={el,button,formatNumber,formatDate,localKey,validDate,aggregateDays,heatLevel,
  MONTHS,TFile,Modal,Notice,Platform,dateFromFile,metrics:metricsModule,review:reviewModule,
  memoryEligible:experienceModule.memoryEligible};
experienceModule.install(JournalView,viewHelpers);
insightsModule.install(JournalView,viewHelpers);
searchModule.install(JournalView,viewHelpers);
toolsModule.install(JournalView,viewHelpers);
reviewModule.install(JournalView,viewHelpers);
module.exports=JournalInsights;
module.exports._test={validDate,localKey,dateFromFile,underFolder,cleanText,countWords,groupStats,aggregateDays,heatLevel,buildCharts,extractImage,repairBanner,JournalView};
