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
