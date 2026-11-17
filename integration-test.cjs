
const assert=require('node:assert/strict'),Module=require('node:module');
class Plugin{constructor(app){this.app=app;}async loadData(){return null}registerView(){}addRibbonIcon(){}addCommand(){}addSettingTab(){}registerEvent(){}async saveData(){}}
class TFile{constructor(path){this.path=path;this.basename=path.split('/').pop().replace(/\.md$/,'');}}
const notices=[];class Notice{constructor(s){notices.push(s)}}
const load=Module._load;Module._load=function(n){if(n==='obsidian')return {Plugin,ItemView:class{},PluginSettingTab:class{},Setting:class{},Notice,TFile};return load.apply(this,arguments)};
const PluginClass=require('./main.js');
function mockApp(failBackup){
 const one=new TFile('01 Daily/2026/2026-01-01-Thursday.md'),two=new TFile('01 Daily/2026/2026-01-02-Friday.md'),tpl=new TFile('06 Templates/Components/Daily Banner Config.md');
 const initial='---\nbanner:\n  - - ThursdayBanner.avif\ndate: 2026-01-01\n---\nKeep my private text intact.\n';
 const values=new Map([[one,initial],[two,initial],[tpl,'banner:\n  - - $'+'{today}Banner.$'+'{bannerExt}\nbanner-y: 0\n']]),storage=new Map(),dirs=new Set(['.archive']);let calls=0;
 const adapter={exists:async p=>dirs.has(p)||storage.has(p),mkdir:async p=>dirs.add(p),write:async(p,v)=>{if(failBackup&&p.endsWith('/before.json'))throw Error('denied');storage.set(p,v)},read:async p=>storage.get(p)};
 const vault={adapter,getMarkdownFiles:()=>[one,two,tpl],read:async f=>values.get(f),process:async(f,cb)=>{calls++;if(f===two)values.set(f,values.get(f)+'A concurrent edit\n');values.set(f,cb(values.get(f)));return values.get(f)}};
 return {app:{vault},one,two,tpl,values,storage,initial,get calls(){return calls}};
}
(async()=>{
 const m=mockApp(false),plugin=new PluginClass(m.app);await plugin.repairBanners();assert.equal(m.calls,3);assert(m.values.get(m.one).includes('banner: "[[ThursdayBanner.avif]]"'));assert(m.values.get(m.one).endsWith('Keep my private text intact.\n'));assert(m.values.get(m.two).endsWith('A concurrent edit\n'));assert(m.values.get(m.two).includes('banner:\n  - -'));assert(m.values.get(m.tpl).includes('banner: "[['));
 const backup=[...m.storage.entries()].find(([p])=>p.endsWith('/before.json'));assert(backup);const content=JSON.parse(backup[1]);assert.equal(content.files.length,3);assert.equal(content.files.find(x=>x.path===m.one.path).text,m.initial);
 const report=JSON.parse([...m.storage.entries()].find(([p])=>p.endsWith('/report.json'))[1]);assert.equal(report.updated,2);assert.equal(report.concurrent,1);assert.equal(report.templates,1);assert.equal(report.failed,0);
 const denied=mockApp(true);await new PluginClass(denied.app).repairBanners();assert.equal(denied.calls,0);assert.equal(denied.values.get(denied.one),denied.initial);
 console.log('PASS: backup before mutation, conflict guard, note preservation, template repair and backup-failure abort');
})().catch(e=>{console.error(e);process.exitCode=1});
