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
