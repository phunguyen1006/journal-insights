const { Plugin, ItemView, PluginSettingTab, Setting, Notice, TFile, Modal, editorInfoField, editorLivePreviewField } = require('obsidian');
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
  function gallery(root,photos,sourcePath,{limit=3,className=''}={}){
    if(!photos||!photos.length)return null;
    const shown=Math.min(limit,photos.length),strip=el(root,'div','ji-photos '+className);strip.setAttribute('aria-label','Journal photos');
    for(let i=0;i<shown;i++){
      const item=resolvePhoto(plugin.app,photos[i],sourcePath,TFile),slot=el(strip,'div','ji-photo-slot'),b=button(slot,'',()=>viewer(photos,sourcePath,i),'ji-photo-tile');
      b.setAttribute('aria-label','Open photo '+(i+1)+' of '+photos.length+(item.kind==='missing'?' (file missing)':item.kind==='remote'?' (external)':item.kind==='dayone'?' (Day One media)':''));
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

const VIEW = 'journal-insights-view';
const DEFAULTS = { dailyFolder: '01 Daily' };
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
    this.generation=0; this.entries=[]; this.memoryDate=localKey(new Date()); this.selectedDay=null;
  }
  getViewType(){return VIEW;}
  getDisplayText(){return 'Journal Insights';}
  getIcon(){return 'book-heart';}
  async onOpen(){this.containerEl.addClass('ji-view'); await this.refresh();}
  async onClose(){this.generation++;for(const observer of this.chartObservers||[])observer.disconnect();}
  async refresh(){
    const generation=++this.generation;
    if(!this.entries.length){this.contentEl.empty();el(this.contentEl,'div','ji-loading','Reading your journal...');}
    const files=this.app.vault.getMarkdownFiles().filter(f=>underFolder(f.path,this.plugin.settings.dailyFolder));
    const rows=[]; let cursor=0,failed=0;
    const worker=async()=>{
      while(cursor<files.length){
        const file=files[cursor++];
        try {
          const raw=await this.app.vault.cachedRead(file);
          const cache=this.app.metadataCache.getFileCache(file);
          const text=cleanText(raw);
          rows.push({file,date:dateFromFile(file,(cache&&cache.frontmatter)||{}),kind:'daily',text,words:countWords(text),photos:photoModule.parsePhotos(raw),private:!!(cache&&cache.frontmatter&&(cache.frontmatter.private===true||cache.frontmatter['journal-insights-hide']===true))});
        }catch(error){failed++;}
      }
    };
    await Promise.all(Array.from({length:Math.min(12,files.length)},()=>worker()));
    if(generation!==this.generation)return;
    rows.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.file.path.localeCompare(b.file.path));
    this.entries=rows; this.failed=failed;
    this.sameDateCounts=new Map();
    for(const row of rows){const key=row.date;this.sameDateCounts.set(key,(this.sameDateCounts.get(key)||0)+1);}
    this.render();
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
  cards(root,items,compact){
    if(!items.length){el(root,'p','ji-empty','No entries to show yet.');return;}
    const grid=el(root,'div',compact?'ji-card-list':'ji-card-grid');
    for(const entry of items){
      const item=el(grid,'article','ji-card-item'+(compact?' is-compact':''));
      const card=button(item,'',()=>this.app.workspace.getLeaf('tab').openFile(entry.file),'ji-card'+(compact?' is-compact':''));
      const meta=el(card,'div','ji-card-meta');el(meta,'span','',formatNumber(entry.words)+' words');
      el(card,'h3','ji-card-date',formatDate(entry.date));
      el(card,'p','ji-card-preview',entry.text?(entry.text.slice(0,220)+(entry.text.length>220?'...':'')):'No text to preview yet.');
      if(entry.date&&(this.sameDateCounts.get(entry.date)||0)>1)el(card,'span','ji-conflict','Multiple entries on this date');
      if(this.plugin.photoController&&this.plugin.settings.experience?.showPhotoPreviews!==false)this.plugin.photoController.gallery(item,entry.photos,entry.file.path,{limit:3,className:'ji-card-photos'});
    }
  }
  renderEntries(root,entries){
    this.title(root,'','Entries',formatNumber(entries.length)+' files');
    const tools=el(root,'div','ji-entry-tools');
    const search=el(tools,'input','ji-input');search.type='search';search.placeholder='Search entries...';search.value=this.query;search.setAttribute('aria-label','Search entries');
    const select=el(tools,'select','ji-select');select.setAttribute('aria-label','Filter entries by year');
    const years=['all',...[...new Set(entries.map(e=>e.date&&e.date.slice(0,4)).filter(Boolean))].sort().reverse()];
    if(!years.includes(this.entryYear))this.entryYear='all';
    for(const year of years){const option=el(select,'option','',year==='all'?'All years':year);option.value=year;} select.value=this.entryYear;
    const results=el(root,'div','ji-results');results.setAttribute('aria-live','polite');
    const draw=()=>{
      results.empty();
      const q=this.query.trim().toLocaleLowerCase();
      const filtered=entries.filter(e=>(!q||(e.text+' '+e.file.basename).toLocaleLowerCase().includes(q))&&(this.entryYear==='all'||(e.date&&e.date.startsWith(this.entryYear))));
      el(results,'p','ji-result-count',formatNumber(filtered.length)+' '+(filtered.length===1?'entry':'entries'));
      this.cards(results,filtered.slice(0,this.limit),false);
      if(filtered.length>this.limit)button(results,'Load more',()=>{this.limit+=36;draw();},'ji-button ji-more');
    };
    search.addEventListener('input',()=>{this.query=search.value;this.limit=36;draw();});
    select.addEventListener('change',()=>{this.entryYear=select.value;this.limit=36;draw();});
    draw();
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
    new Setting(c).setName('Daily folder').setDesc('Folder path relative to the vault.').addText(t=>t.setValue(this.plugin.settings.dailyFolder).onChange(async value=>{this.plugin.settings.dailyFolder=value.trim().replace(/^\/+|\/+$/g,'');await this.plugin.saveSettings();}));
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
    this.photoController=photoModule.makeController(this,{Modal,TFile,el,button});
    galleryModule.registerNoteGalleries(this,{photos:photoModule,TFile,editorInfoField,editorLivePreviewField,Notice});
    this.registerView(VIEW,leaf=>new JournalView(leaf,this));
    this.addRibbonIcon('book-heart','Open Journal Insights',()=>this.activateView());
    this.addCommand({id:'open-journal-insights',name:'Open Journal Insights',callback:()=>this.activateView()});
    this.addCommand({id:'repair-pixel-banner-properties',name:'Repair Pixel Banner properties',callback:()=>this.repairBanners()});
    this.addSettingTab(new JournalSettings(this.app,this));
    const schedule=()=>{clearTimeout(this.refreshTimer);this.refreshTimer=setTimeout(()=>this.app.workspace.getLeavesOfType(VIEW).forEach(leaf=>leaf.view.refresh()),1500);};
    const relevant=p=>underFolder(p,this.settings.dailyFolder);
    const isImage=path=>/\.(?:png|jpe?g|gif|webp|avif|svg|bmp|heic|heif|tiff?)$/i.test(path);
    const changed=file=>{if(file instanceof TFile&&(relevant(file.path)||isImage(file.path)))schedule();};
    this.registerEvent(this.app.vault.on('create',changed));this.registerEvent(this.app.vault.on('modify',changed));this.registerEvent(this.app.vault.on('delete',changed));
    this.registerEvent(this.app.vault.on('rename',(file,old)=>{if(file instanceof TFile&&(relevant(file.path)||relevant(old)||isImage(file.path)||isImage(old)))schedule();}));
    if(typeof this.app.metadataCache?.on==='function')this.registerEvent(this.app.metadataCache.on('resolved',schedule));
    this.app.workspace.onLayoutReady(()=>{if(this.settings.openOnStartup)this.activateView();});
  }
  onunload(){clearTimeout(this.refreshTimer);}
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
  }
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
const experienceModule=(()=>{const module={exports:{}};
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

function install(JournalView,{el,button,formatNumber:n,formatDate:fd,localKey,validDate,aggregateDays,heatLevel,MONTHS,TFile,Notice}) {
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
      return {...p,order:[...new Set([...(Array.isArray(p.order)?p.order.filter(x=>HOME.includes(x)):[]),...HOME])],hidden:Array.isArray(p.hidden)?p.hidden:[],excluded:Array.isArray(p.excluded)?p.excluded:[]};
    },
    async savePrefs(changes){
      const old=this.plugin.settings.experience,updated={...this.prefs(),...changes};
      this.plugin.settings.experience=updated;
      try{await this.plugin.saveSettings();return true;}catch(error){if(this.plugin.settings.experience===updated)this.plugin.settings.experience=old;new Notice('Could not save settings. Please try again.');return false;}
    },
    navigate(tab){this.tab=tab;this.limit=36;this.drill=null;this.render();this.contentEl.scrollTop=0;},
    yearControl(root,entries){
      const years=[...new Set([String(new Date().getFullYear()),...entries.filter(e=>e.date&&e.date<=localKey(new Date())).map(e=>e.date.slice(0,4))])].sort().reverse();
      if(!years.includes(this.year))this.year=years[0];const select=el(root,'select','ji-select ji-year');select.setAttribute('aria-label','Select year');for(const year of years){const o=el(select,'option','',year);o.value=year;}select.value=this.year;select.addEventListener('change',()=>{this.year=select.value;this.drill=null;this.savePrefs({year:this.year});this.render();});
    },
    render(){
      this.prefs();
      for(const observer of this.chartObservers||[])observer.disconnect();this.chartObservers=[];
      const root=this.contentEl;root.empty();this.dayRegion=null;
      const shell=el(root,'div','ji-shell'),header=el(shell,'header','ji-header');
      const brand=el(header,'div','ji-brand');el(brand,'h1','ji-title','Journal Insights');
      const actions=el(header,'div','ji-header-actions');
      button(actions,'Refresh',async event=>{const b=event.currentTarget||event.target;b.disabled=true;b.textContent='Refreshing…';try{await this.refresh();}finally{b.disabled=false;}},'ji-button ji-quiet');
      const nav=el(shell,'nav','ji-nav');nav.setAttribute('aria-label','Journal navigation');
      for(const [id,label] of [['home','Home'],['entries','Entries'],['calendar','Calendar'],['memories','On This Day'],['insights','Insights'],['settings','Settings']]){const b=button(nav,label,()=>this.navigate(id),'ji-nav-item'+(this.tab===id?' is-active':''));if(this.tab===id)b.setAttribute('aria-current','page');}
      if(this.failed)el(shell,'p','ji-warning','Could not read '+this.failed+' files. Refresh to retry.');
      const entries=this.subset(),stats=aggregateDays(entries.filter(e=>e.date&&e.date<=localKey(new Date())));
      const main=el(shell,'main','ji-main');main.setAttribute('aria-label','Journal Insights content');
      if(this.tab==='home')this.renderHome(main,entries,stats);
      if(this.tab==='entries')this.renderEntries(main,entries);
      if(this.tab==='calendar')this.renderCalendar(main,entries,stats);
      if(this.tab==='memories')this.renderMemories(main,entries);
      if(this.tab==='insights')this.renderInsights(main,entries,stats);
      if(this.tab==='settings')this.renderSettings(main);
    },
    metric(root,value,label,note){const box=el(root,'div','ji-stat');el(box,'span','ji-stat-label',label);el(box,'strong','ji-stat-number',value);if(note){box.title=note;box.setAttribute('role','group');box.setAttribute('aria-label',label+': '+value+'. '+note);}return box;},
    renderHome(root,entries,stats){
      const top=el(root,'div','ji-home-top');el(top,'span','ji-home-date',fd(localKey(new Date()),{weekday:'long',month:'long',day:'numeric',year:'numeric'}));
      const today=entries.filter(e=>e.date===localKey(new Date()));if(today.length)button(top,'Open today',()=>this.explore('Today',today),'ji-button');
      const prefs=this.prefs();
      const sections=el(root,'div','ji-home-layout');
      for(const id of prefs.order){
        if(prefs.hidden.includes(id))continue;
        const section=el(sections,'section','ji-panel ji-home-'+id);
        if(id==='memories'){
          const h=this.title(section,'','On This Day');button(h,'View all',()=>this.navigate('memories'),'ji-link');
          const memories=this.memoriesFor(entries,localKey(new Date()));
          if(memories.length)this.memoryCards(section,memories.slice(0,2),localKey(new Date()));else{el(section,'p','ji-empty','No memories for today.');button(section,'Random Memory',()=>this.randomMemory(entries),'ji-button');}
        }else if(id==='recent'){
          const h=this.title(section,'','Recent Entries');button(h,'View all',()=>this.navigate('entries'),'ji-link');this.cards(section,entries.filter(e=>e.words>0||(e.photos&&e.photos.length)).slice(0,3),true);
        }else if(id==='activity'){
          const h=this.title(section,'','Writing Activity');this.yearControl(h,entries);this.heatmap(section,stats,Number(this.year));
        }else{this.title(section,'','At a Glance');const grid=el(section,'div','ji-stats');this.metric(grid,n(stats.active.length),'Writing days','Unique dates with text');this.metric(grid,n(stats.words),'Words written','Estimated, through today');this.metric(grid,n(stats.streak),'Current streak','Through today or yesterday');this.metric(grid,n(stats.longest),'Longest streak','Consecutive writing days');button(section,'View insights',()=>this.navigate('insights'),'ji-link');}
      }
      if(prefs.hidden.length===HOME.length){el(root,'p','ji-empty','All Home sections are hidden.');button(root,'Open Settings',()=>this.navigate('settings'),'ji-button');}
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
      const prefs=this.prefs(),list=el(home,'div','ji-settings-list');
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
      el(memories,'p','ji-settings-help','Hide entries from On This Day and Random Memory. Notes and statistics are unchanged.');
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

      const advanced=el(settings,'section','ji-settings-section');el(advanced,'h3','ji-settings-title','Folder');
      const folderInputs={};
      for(const [key,label] of [['dailyFolder','Daily folder']]){
        const lab=el(advanced,'label','ji-folder-row');el(lab,'span','ji-setting-name',label);const input=el(lab,'input','ji-input');input.type='text';input.value=this.plugin.settings[key]||'';folderInputs[key]=input;
      }
      const error=el(advanced,'p','ji-settings-error');error.setAttribute('role','alert');
      button(advanced,'Save folder',async event=>{
        const b=event.currentTarget||event.target;
        const clean=value=>value.trim().replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
        const daily=clean(folderInputs.dailyFolder.value);
        const exists=path=>path&&!path.split('/').some(part=>part==='.'||part==='..'||!part)&&this.app.vault.getAbstractFileByPath&&Array.isArray(this.app.vault.getAbstractFileByPath(path)?.children);
        if(!exists(daily)){error.textContent='Choose an existing folder in this vault.';return;}
        error.textContent='';b.disabled=true;const before={dailyFolder:this.plugin.settings.dailyFolder};Object.assign(this.plugin.settings,{dailyFolder:daily});
        try{await this.plugin.saveSettings();}catch(e){Object.assign(this.plugin.settings,before);error.textContent='Could not save folders. Please try again.';b.disabled=false;return;}
        new Notice('Folder saved.');try{await this.refresh();}finally{b.disabled=false;}
      },'ji-button');
      const maintenance=el(settings,'details','ji-settings-details ji-maintenance');el(maintenance,'summary','','Maintenance');
      el(maintenance,'p','ji-settings-help','Repair legacy Pixel Banner properties with a backup.');
      button(maintenance,'Repair banners',()=>this.plugin.repairBanners(),'ji-button');
    },
    memoriesFor(entries,key){return entries.filter(e=>memoryEligible(e,this.prefs().excluded)&&e.date.slice(5)===key.slice(5)&&e.date.slice(0,4)<key.slice(0,4));},
    randomMemory(entries){
      const candidates=entries.filter(e=>memoryEligible(e,this.prefs().excluded)&&e.date<localKey(new Date())&&(!this.randomEntry||e.file.path!==this.randomEntry.file.path));
      if(!candidates.length){new Notice('No other memories available.');return;}
      this.randomEntry=candidates[Math.floor(Math.random()*candidates.length)];this.navigate('memories');
    },
    memoryCards(root,entries,reference){
      const grid=el(root,'div','ji-memory-cards');
      for(const entry of entries){const card=el(grid,'article','ji-memory-card');
        if(this.plugin.photoController&&this.plugin.settings.experience?.showPhotoPreviews!==false)this.plugin.photoController.gallery(card,entry.photos,entry.file.path,{limit:3,className:'ji-memory-photos'});
        const content=el(card,'div','ji-memory-copy'),years=Number(reference.slice(0,4))-Number(entry.date.slice(0,4));
        el(content,'span','ji-memory-age',years>0?years+' '+(years===1?'year':'years')+' ago':'Earlier this year');el(content,'h3','ji-memory-date',fd(entry.date));
        el(content,'span','ji-muted',n(entry.words)+' words');el(content,'p','ji-memory-excerpt',entry.text.slice(0,330)+(entry.text.length>330?'…':''));
        const actions=el(content,'div','ji-memory-actions');button(actions,'Read Entry',()=>this.app.workspace.getLeaf('tab').openFile(entry.file),'ji-button');
      }
    },
    renderMemories(root,entries){
      const h=this.title(root,'','On This Day'),tools=el(h,'div','ji-memory-tools');
      const input=el(tools,'input','ji-input ji-date-input');input.type='date';input.value=this.memoryDate;input.max=localKey(new Date());input.setAttribute('aria-label','Select a date for memories');
      input.addEventListener('change',()=>{if(input.value&&input.value<=localKey(new Date())&&validDate(...input.value.split('-'))===input.value){this.memoryDate=input.value;this.randomEntry=null;this.render();}});
      button(tools,'Today',()=>{this.memoryDate=localKey(new Date());this.randomEntry=null;this.render();},'ji-button');button(tools,'Random Memory',()=>this.randomMemory(entries),'ji-button');
      if(this.randomEntry&&memoryEligible(this.randomEntry,this.prefs().excluded)){const panel=el(root,'section','ji-panel ji-random-panel');const rh=this.title(panel,'','Random Memory');button(rh,'Dismiss',()=>{this.randomEntry=null;this.render();},'ji-link');this.memoryCards(panel,[this.randomEntry],localKey(new Date()));}
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
      const detail=el(root,'p','ji-heat-detail','');detail.setAttribute('role','status');
      const wrap=el(root,'div','ji-months'),today=localKey(new Date());
      for(let month=0;month<12;month++){
        const section=el(wrap,'section','ji-month');el(section,'h3','ji-month-title',MONTHS[month]);const grid=el(section,'div','ji-calendar-grid');
        for(const d of ['M','T','W','T','F','S','S'])el(grid,'span','ji-weekday',d);
        const offset=(new Date(year,month,1,12).getDay()+6)%7;for(let i=0;i<offset;i++)el(grid,'span','ji-day-spacer');
        for(let day=1;day<=new Date(year,month+1,0).getDate();day++){
          const key=validDate(year,month+1,day),record=stats.days.get(key),value=heatValue(record,mode),isFuture=key>today;
          const label=fd(key)+': '+n(record?record.words:0)+' words · '+n(record?record.records.filter(e=>e.words>0).length:0)+' nonempty entries'+(isFuture?' · Future date':'');
          const b=button(grid,String(day),()=>{this.selectedDay=key;if(this.tab!=='calendar'){this.tab='calendar';this.year=String(year);this.render();this.showDay(key,true);}else{this.showDay(key,true);for(const x of grid.querySelectorAll?wrap.querySelectorAll('[aria-pressed]'):[])x.setAttribute('aria-pressed','false');b.setAttribute('aria-pressed','true');}},'ji-day '+(isFuture?'is-future':'ji-level-'+levelFor(value,mode,heatLevel))+(key===today?' is-today':''));
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
      const h=this.title(root,'','Insights');const controls=el(h,'div','ji-insight-controls');
      const select=el(controls,'select','ji-select');select.setAttribute('aria-label','Insights period');for(const [id,label] of [['30','Last 30 days'],['90','Last 90 days'],['year','Selected year'],['all','All time'],['custom','Custom dates']]){const o=el(select,'option','',label);o.value=id;}select.value=this.rangeMode;select.addEventListener('change',()=>{this.rangeMode=select.value;this.drill=null;this.savePrefs({rangeMode:this.rangeMode});this.render();});if(this.rangeMode==='year')this.yearControl(controls,entries);
      const today=localKey(new Date());
      if(this.rangeMode==='custom'){const tools=el(root,'div','ji-date-range');for(const [key,label] of [['start','From'],['end','Through']]){const lab=el(tools,'label','ji-date-label');el(lab,'span','',label);const input=el(lab,'input','ji-input');input.type='date';input.max=today;input.value=this.customRange[key]||'';input.addEventListener('change',()=>{this.customRange[key]=input.value;this.savePrefs({customRange:this.customRange});});}button(tools,'Apply dates',()=>{this.drill=null;this.render();},'ji-button');}
      const range=rangeFor(entries,this.rangeMode,Number(this.year),today,this.customRange);if(range.error){el(root,'p','ji-warning',range.error);return;}
      const d=analyze(entries,range,aggregateDays,today);el(root,'p','ji-period-caption',fd(range.start,{month:'short',day:'numeric',year:'numeric'})+' – '+fd(range.end,{month:'short',day:'numeric',year:'numeric'})+' · '+n(range.days)+' calendar days');
      const grid=el(root,'div','ji-stats ji-insight-stats');
      this.metric(grid,n(d.data.words),'Words written','Longest daily version per date');this.metric(grid,n(d.data.active.length),'Writing days','Unique dates with text');this.metric(grid,d.rate+'%','Consistency',n(d.data.active.length)+' of '+n(range.days)+' calendar days');this.metric(grid,n(d.average),'Words / writing day','Mean across active days');
      const secondary=el(root,'details','ji-more-metrics');secondary.open=true;el(secondary,'summary','','More about this period');const extra=el(secondary,'div','ji-stats ji-secondary-stats');
      this.metric(extra,n(d.median),'Median day','Middle active-day word count');this.metric(extra,n(d.perCalendar),'Words / calendar day','Includes days without writing');this.metric(extra,n(d.data.longest),'Longest streak','Within the selected period');this.metric(extra,n(d.top[0]?d.top[0].words:0),'Longest day',d.top[0]?d.top[0].date:'No writing yet');this.metric(extra,n(d.records.filter(e=>e.words>0).length),'Nonempty files','Includes Daily conflict versions');this.metric(extra,n(aggregateDays(entries.filter(e=>e.date&&e.date<=today)).streak),'Current streak','All time, through today or yesterday');
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
experienceModule.install(JournalView,{el,button,formatNumber,formatDate,localKey,validDate,aggregateDays,heatLevel,MONTHS,TFile,Notice});
module.exports=JournalInsights;
module.exports._test={validDate,localKey,dateFromFile,underFolder,cleanText,countWords,groupStats,aggregateDays,heatLevel,buildCharts,extractImage,repairBanner,JournalView};
