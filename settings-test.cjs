const assert=require('node:assert/strict'),Module=require('node:module');
const old=Module._load;Module._load=function(name){if(name==='obsidian')return {Plugin:class{},ItemView:class{},PluginSettingTab:class{},Setting:class{},Notice:class{},TFile:class{}};return old.apply(this,arguments);};
const JournalInsights=require('./main.js');
const {JournalView}=JournalInsights._test;
(async()=>{
  const plugin=new JournalInsights(),saved=[];let release;
  plugin.settings={openOnStartup:true,experience:{hidden:[],excluded:['keep.md']}};
  plugin.saveData=async value=>{if(!saved.length)await new Promise(resolve=>release=resolve);saved.push(value)};
  const first=plugin.saveSettings();
  await new Promise(resolve=>setImmediate(resolve));
  plugin.settings.experience.hidden=['recent'];plugin.settings.openOnStartup=false;
  const second=plugin.saveSettings();
  assert.equal(saved.length,0);release();await Promise.all([first,second]);
  assert.deepEqual(saved.map(s=>s.openOnStartup),[true,false]);
  assert.deepEqual(saved.map(s=>s.experience.hidden),[[],['recent']]);
  assert.deepEqual(saved[1].experience.excluded,['keep.md']);

  let call=0;plugin.saveData=async()=>{if(call++===0)throw Error('simulated write failure');};
  const failed=plugin.saveSettings(),following=plugin.saveSettings();
  await assert.rejects(failed,/simulated/);await following;assert.equal(call,2);

  const view=Object.create(JournalView.prototype);
  view.experienceReady=true;view.plugin={settings:{experience:{order:['activity','memories','recent','stats'],hidden:['recent'],excluded:['keep.md']}},saveSettings:async()=>{}};
  assert.equal(await view.savePrefs({hidden:['stats']}),true);
  assert.deepEqual(view.prefs().order,['activity','memories','recent','stats']);assert.deepEqual(view.prefs().excluded,['keep.md']);
  view.plugin.saveSettings=async()=>{throw Error('simulated')};
  assert.equal(await view.savePrefs({excluded:[]}),false);assert.deepEqual(view.prefs().excluded,['keep.md']);
  console.log('PASS: serialized settings writes, immutable snapshots, failed-write recovery, and preservation of Home order and hidden Memories.');
})().catch(e=>{console.error(e);process.exitCode=1});
