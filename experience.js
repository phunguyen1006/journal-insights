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
        }else{this.title(section,'','At a Glance');const grid=el(section,'div','ji-stats'),streak=metrics.journalStreak(stats.days,localKey(new Date()));this.metric(grid,n(stats.active.length),'Writing days','Unique dates with text');this.metric(grid,n(stats.words),'Words written','Estimated, through today');this.metric(grid,n(streak.current),'Current streak','Days with text or linked images, through today or yesterday');this.metric(grid,n(streak.longest),'Longest streak','Consecutive days with text or linked images');const details=el(section,'details','ji-heat-about');el(details,'summary','','Streak details');el(details,'p','ji-settings-help','A journal day has text or at least one linked image. Empty templates do not count. '+(streak.current?'Current streak includes '+n(streak.photoOnly)+' photo-only '+(streak.photoOnly===1?'day.':'days.'):'No current streak.')+(streak.breakHasNote?' Last break: '+fd(streak.breakDate)+' (note has no text or linked images).':' Last break: '+fd(streak.breakDate)+' (no daily note).'));button(section,'View insights',()=>this.navigate('insights'),'ji-link');}
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
      for(const [key,label] of [['dailyFolder','Daily folder'],['weeklyFolder','Weekly folder']]){
        const lab=el(advanced,'label','ji-folder-row');el(lab,'span','ji-setting-name',label);const input=el(lab,'input','ji-input');input.type='text';input.value=this.plugin.settings[key]||'';folderInputs[key]=input;
      }
      const error=el(advanced,'p','ji-settings-error');error.setAttribute('role','alert');
      button(advanced,'Save folder',async event=>{
        const b=event.currentTarget||event.target;
        const clean=value=>value.trim().replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
        const daily=clean(folderInputs.dailyFolder.value),weekly=clean(folderInputs.weeklyFolder.value);
        const exists=path=>path&&!path.split('/').some(part=>part==='.'||part==='..'||!part)&&this.app.vault.getAbstractFileByPath&&Array.isArray(this.app.vault.getAbstractFileByPath(path)?.children);
        if(!exists(daily)||(weekly&&!exists(weekly))){error.textContent='Choose an existing Daily folder and, if supplied, an existing Weekly folder.';return;}
        error.textContent='';b.disabled=true;const before={dailyFolder:this.plugin.settings.dailyFolder,weeklyFolder:this.plugin.settings.weeklyFolder};Object.assign(this.plugin.settings,{dailyFolder:daily,weeklyFolder:weekly});
        try{await this.plugin.saveSettings();}catch(e){Object.assign(this.plugin.settings,before);error.textContent='Could not save folders. Please try again.';b.disabled=false;return;}
        new Notice('Folder saved.');try{await this.refresh();}finally{b.disabled=false;}
      },'ji-button');
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
      const h=this.title(root,'','Insights');const controls=el(h,'div','ji-insight-controls');
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
