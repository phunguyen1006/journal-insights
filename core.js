const { Plugin, ItemView, PluginSettingTab, Setting, Notice, TFile, Modal, editorInfoField, editorLivePreviewField } = require('obsidian');
const photoModule = require('./photos');
const galleryModule = require('./editor-gallery');
const metricsModule = require('./metrics');
const cleanupModule = require('./cleanup');

const VIEW = 'journal-insights-view';
const DEFAULTS = { dailyFolder: '01 Daily', weeklyFolder: '02 Weekly' };
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
    this.generation=0; this.entries=[]; this.weekEntries=[]; this.memoryDate=localKey(new Date()); this.selectedDay=null;
  }
  getViewType(){return VIEW;}
  getDisplayText(){return 'Journal Insights';}
  getIcon(){return 'book-heart';}
  async onOpen(){this.containerEl.addClass('ji-view'); await this.refresh();}
  async onClose(){this.generation++;for(const observer of this.chartObservers||[])observer.disconnect();}
  async refresh(){
    const generation=++this.generation;
    if(!this.entries.length){this.contentEl.empty();el(this.contentEl,'div','ji-loading','Reading your journal...');}
    const allFiles=this.app.vault.getMarkdownFiles();
    const files=allFiles.filter(f=>underFolder(f.path,this.plugin.settings.dailyFolder));
    const weeklyFolder=typeof this.plugin.settings.weeklyFolder==='string'?this.plugin.settings.weeklyFolder:DEFAULTS.weeklyFolder;
    const weeklyFiles=allFiles.filter(f=>underFolder(f.path,weeklyFolder));
    const rows=[],weekRows=[]; let cursor=0,weekCursor=0,failed=0;
    const worker=async()=>{
      while(cursor<files.length){
        const file=files[cursor++];
        try {
          const raw=await this.app.vault.cachedRead(file);
          const cache=this.app.metadataCache.getFileCache(file);
          const text=cleanText(raw);
          rows.push({file,date:dateFromFile(file,(cache&&cache.frontmatter)||{}),kind:'daily',text,words:countWords(text),rating:metricsModule.score(cache?.frontmatter?.dayRating),photos:photoModule.parsePhotos(raw),private:!!(cache&&cache.frontmatter&&(cache.frontmatter.private===true||cache.frontmatter['journal-insights-hide']===true))});
        }catch(error){failed++;}
      }
    };
    const weekWorker=async()=>{while(weekCursor<weeklyFiles.length){const file=weeklyFiles[weekCursor++];try{const cache=this.app.metadataCache.getFileCache(file);weekRows.push({file,wheel:cache?.frontmatter?.wheelOfLife||null});}catch(error){failed++;}}};
    await Promise.all([...Array.from({length:Math.min(12,files.length)},()=>worker()),...Array.from({length:Math.min(8,weeklyFiles.length)},()=>weekWorker())]);
    if(generation!==this.generation)return;
    rows.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.file.path.localeCompare(b.file.path));
    this.entries=rows; this.weekEntries=weekRows; this.failed=failed;
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
      const meta=el(card,'div','ji-card-meta');el(meta,'span','',formatNumber(entry.words)+' words');if(entry.rating!==null&&entry.rating!==undefined)el(meta,'span','','Rating '+formatNumber(entry.rating)+' / 10');
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
    new Setting(c).setName('Weekly folder').setDesc('Folder containing Wheel of Life weekly notes.').addText(t=>t.setValue(this.plugin.settings.weeklyFolder).onChange(async value=>{this.plugin.settings.weeklyFolder=value.trim().replace(/^\/+|\/+$/g,'');await this.plugin.saveSettings();}));
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
    this.addCommand({id:'clean-empty-daily-sections',name:'Clean empty Daily sections',callback:()=>this.cleanupDailySections()});
    this.addSettingTab(new JournalSettings(this.app,this));
    const schedule=()=>{clearTimeout(this.refreshTimer);this.refreshTimer=setTimeout(()=>this.app.workspace.getLeavesOfType(VIEW).forEach(leaf=>leaf.view.refresh()),1500);};
    const relevant=p=>underFolder(p,this.settings.dailyFolder)||underFolder(p,this.settings.weeklyFolder);
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
require('./experience').install(JournalView,{el,button,formatNumber,formatDate,localKey,validDate,aggregateDays,heatLevel,MONTHS,TFile,Notice,metrics:metricsModule});
require('./insight-extras').install(JournalView,{el,button,formatNumber,formatDate,localKey,metrics:metricsModule});
module.exports=JournalInsights;
module.exports._test={validDate,localKey,dateFromFile,underFolder,cleanText,countWords,groupStats,aggregateDays,heatLevel,buildCharts,extractImage,repairBanner,JournalView};
