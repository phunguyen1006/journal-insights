const fs=require('fs'),path=require('path');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const core=read('core.js'),experience=read('experience.js');
const inline=name=>"(()=>{const module={exports:{}};\n"+read(name)+"\nreturn module.exports;})()";
const bundled=core.replace("require('./photos')",()=>inline('photos.js')).replace("require('./editor-gallery')",()=>inline('editor-gallery.js')).replace("require('./experience').install(",()=>"const experienceModule=(()=>{const module={exports:{}};\n"+experience+"\nreturn module.exports;})();\nexperienceModule.install(");
fs.writeFileSync(path.join(__dirname,'main.js'),bundled);
console.log('Built self-contained main.js (desktop/mobile; no external chart dependencies).');
