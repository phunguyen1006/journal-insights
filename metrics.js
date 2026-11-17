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
