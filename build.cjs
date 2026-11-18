const fs=require('fs'),path=require('path');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const core=read('core.js');
const inline=name=>"(()=>{const module={exports:{}};\n"+read(name)+"\nreturn module.exports;})()";
const moduleNames = ['photos', 'editor-gallery', 'metrics', 'cleanup', 'insight-extras',
  'experience', 'journal-index', 'entry-search', 'journal-tools', 'journal-review'];
let bundled = core;
for (const name of moduleNames) {
  const importLine = "require('./" + name + "')";
  if (!bundled.includes(importLine)) throw new Error('No import found for ' + name);
  bundled = bundled.replace(importLine, () => inline(name + '.js'));
}
fs.writeFileSync(path.join(__dirname,'main.js'),bundled);
console.log('Built self-contained main.js (desktop/mobile; no external chart dependencies).');
