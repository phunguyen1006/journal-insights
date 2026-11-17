
const assert=require('node:assert/strict'),Module=require('node:module'),fs=require('node:fs'),path=require('node:path');
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};this.attributes={};this.style={};this.textContent='';this.value='';this.className='';}
 appendChild(c){this.children.push(c);c.parent=this;return c;}addEventListener(k,fn){this.listeners[k]=fn;}setAttribute(k,v){this.attributes[k]=v;}addClass(c){this.className+=' '+c;}empty(){this.children=[];this.textContent='';}scrollIntoView(){}remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}dispatch(k){if(this.listeners[k])return this.listeners[k]({target:this});}
}
global.document={createElement:t=>new Element(t),createElementNS:(_,t)=>new Element(t)};
class TFile{constructor(p){this.path=p;this.basename=p.split('/').pop().replace(/\.md$/,'');}}
class ItemView{constructor(leaf){this.app=leaf.app;this.containerEl=new Element();this.contentEl=new Element();}}
class Plugin{constructor(app){this.app=app;}async loadData(){return null}registerView(){}addRibbonIcon(){}addCommand(){}addSettingTab(){}registerEvent(){}async saveData(){}}
const notices=[];class Notice{constructor(s){notices.push(s)}}
const original=Module._load;Module._load=function(n){if(n==='obsidian')return {Plugin,ItemView,PluginSettingTab:class{},Setting:class{},Notice,TFile};return original.apply(this,arguments)};
const PluginClass=require('./main.js'),{validDate,dateFromFile,cleanText,countWords,aggregateDays,heatLevel,buildCharts,repairBanner,JournalView}=PluginClass._test;
assert.equal(validDate(2024,2,29),'2024-02-29');assert.equal(validDate(2025,2,29),null);assert.equal(dateFromFile({basename:'2026-11-16-test'},{}),'2026-11-16');
assert.equal(cleanText('---\ndate: 2026-01-01\n---\n- Hello world\n'), 'Hello world');
assert.equal(countWords('Hello world'),2);
const sample='---\nbanner:\n  - - SaturdayBanner.avif\nbanner-y: 0\n---\nPrivate text stays here\n';
let fixed=repairBanner(sample,false);assert(fixed.changed);assert.equal(fixed.text,'---\nbanner: "[[SaturdayBanner.avif]]"\nbanner-y: 0\n---\nPrivate text stays here\n');assert.equal(repairBanner(fixed.text,false).changed,false);
const multi='---\nbanner:\n  - - A.gif\n  - - B.gif\nbanner-y: 1\n---\nBody\n';
fixed=repairBanner(multi,false);assert(fixed.changed&&fixed.legacy);assert(fixed.text.includes('banner: "[[A.gif]]"'));assert(fixed.text.includes('journal-insights-legacy-banners: ["[[A.gif]]","[[B.gif]]"]'));assert(fixed.text.endsWith('---\nBody\n'));
const duplicate='---\nbanner:\n  - - A.gif\n  - - A.gif\nother: 2\n---\nBody';fixed=repairBanner(duplicate,false);assert(fixed.changed&&!fixed.legacy);assert(!fixed.text.includes('legacy-banners'));
const malformed='---\nbanner:\n  - - strange value\n---\nBody';assert.equal(repairBanner(malformed,false).changed,false);
const dynamic='banner:\n  - - $'+'{today}Banner.$'+'{bannerExt}\nbanner-y: 10\n';
fixed=repairBanner(dynamic,true);assert.equal(fixed.text,'banner: "[[$'+'{today}Banner.$'+'{bannerExt}]]"\nbanner-y: 10\n');assert.equal(repairBanner(fixed.text,true).changed,false);
const rows=[{date:'2026-11-15',kind:'daily',words:120},{date:'2026-11-15',kind:'daily',words:220},{date:'2026-11-15',kind:'dream',words:80},{date:'2026-11-16',kind:'daily',words:30}];
const stats=aggregateDays(rows,new Date(2026,10,16,12));assert.equal(stats.days.get('2026-11-15').words,220);assert.equal(stats.words,250);assert.equal(stats.streak,2);assert.equal(stats.conflicts,1);assert.equal(stats.days.get('2026-11-15').records.length,2);
assert.deepEqual([0,1,99,100,299,300,699,700].map(heatLevel),[0,1,1,2,2,3,3,4]);
const charts=buildCharts(rows,2026);assert.equal(charts.months[10].value,250);assert.equal(charts.activeDays,2);assert.equal(charts.average,125);assert.equal(charts.lengths[0].value,1);assert.equal(charts.lengths[1].value,1);
function all(n){return [n,...n.children.flatMap(all)]}function find(n,tag,text){return all(n).find(x=>x.tag===tag&&x.textContent===text)}function click(n,text){const x=find(n,'button',text);assert.ok(x,'missing '+text);x.dispatch('click')}
(async()=>{
 let opened=null;const today=new Date(),key=validDate(today.getFullYear(),today.getMonth()+1,today.getDate());
 const daily=new TFile('01 Daily/'+key+'-day.md'),dream=new TFile('08 Dreams/'+key+'-dream.md');
 const memory=new TFile('01 Daily/'+(today.getFullYear()-1)+'-'+key.slice(5)+'-memory.md');
 const values=new Map([[daily,'- Hello world'],[dream,'- I saw a dream'],[memory,'- Old memory']]);
 const app={vault:{getMarkdownFiles:()=>[daily,dream,memory],cachedRead:async f=>values.get(f)},metadataCache:{getFileCache:()=>null,getFirstLinkpathDest:()=>null},workspace:{getLeaf:()=>({openFile:f=>{opened=f;}})}};
 const plugin={settings:{dailyFolder:'01 Daily',experience:{kind:'dream'}}};const view=new JournalView({app},plugin);await view.onOpen();assert.ok(find(view.contentEl,'h1','Journal Insights'));assert.ok(find(view.contentEl,'h2','On This Day'));assert.equal(view.subset().length,2);assert(!view.entries.some(e=>e.file===dream));assert(!find(view.contentEl,'button','Dreams'));click(view.contentEl,'Entries');
 let input=all(view.contentEl).find(x=>x.tag==='input');input.value='Hello';input.dispatch('input');let cards=all(view.contentEl).filter(x=>x.tag==='button'&&x.className.includes('ji-card'));assert.equal(cards.length,1);cards[0].dispatch('click');assert.equal(opened,daily);
 click(view.contentEl,'Calendar');assert.ok(all(view.contentEl).some(x=>x.className.includes('ji-level-1')));
 click(view.contentEl,'On This Day');assert.ok(find(view.contentEl,'h2','On This Day'));
 click(view.contentEl,'Insights');assert.ok(find(view.contentEl,'h2','Words by month'));assert.ok(find(view.contentEl,'h2','Writing days by weekday'));assert.ok(find(view.contentEl,'h2','Daily writing length'));
 let runAtStartup=null;const workspace={onLayoutReady:cb=>{runAtStartup=cb},getLeavesOfType:()=>[],getLeaf:()=>({setViewState:async()=>{}}),revealLeaf:async()=>{}};const events={on:()=>({})};const pl=new PluginClass({vault:events,workspace});await pl.onload();assert.equal(pl.settings.openOnStartup,true);assert.equal(typeof runAtStartup,'function');
 const legacy=new PluginClass({vault:events,workspace}),saved=[];legacy.loadData=async()=>({dailyFolder:'01 Daily',dreamFolder:'08 Dreams',experience:{kind:'dream',order:['recent','memories'],excluded:['01 Daily/a.md']}});legacy.saveData=async data=>saved.push(data);await legacy.onload();assert(!('dreamFolder' in legacy.settings));assert(!('kind' in legacy.settings.experience));assert.deepEqual(legacy.settings.experience.order,['recent','memories']);assert.deepEqual(legacy.settings.experience.excluded,['01 Daily/a.md']);assert.equal(saved.length,1);assert(!('dreamFolder' in saved[0]));assert(!('kind' in saved[0].experience));
 console.log('PASS: parser, quoted banners, multiple banner preservation, template generation, aggregation, heatmap bins, charts, English navigation, startup registration');
 if(process.argv[2]){
   const root=process.argv[2],todo=[],unsupported=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name.startsWith('.'))continue;const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(e.name.endsWith('.md')){const rel=path.relative(root,f).split(path.sep).join('/');if(/^(00 Dashboard|01 Daily|02 Weekly|03 Monthly|04 Quarterly|05 Yearly)\//.test(rel)||/^06 Templates\/Components\/(Daily|Weekly|Monthly|Quarterly|Yearly) Banner Config\.md$/.test(rel)){const old=fs.readFileSync(f,'utf8'),isTemplate=rel.startsWith('06 Templates/'),r=repairBanner(old,isTemplate);if(r.changed){if(!isTemplate){const oldBody=old.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/,'');const newBody=r.text.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/,'');assert.equal(oldBody,newBody,'body changed: '+rel);}assert.equal(repairBanner(r.text,isTemplate).changed,false,'not idempotent: '+rel);todo.push({path:rel,kind:r.kind,legacy:!!r.legacy});}else if(r.reason)unsupported.push({path:rel,reason:r.reason});}}}}walk(root);console.log(JSON.stringify({planned:todo.length,notes:todo.filter(x=>x.kind==='note').length,templates:todo.filter(x=>x.kind==='template').length,legacyPreserved:todo.filter(x=>x.legacy).length,unsupported},null,2));
 }
})().catch(e=>{console.error(e);process.exitCode=1});
