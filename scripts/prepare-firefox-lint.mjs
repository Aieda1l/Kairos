import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildFirefoxExtension} from './build-firefox-extension.mjs';
const root=fs.realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const output=path.join(root,'artifacts','firefox-lint');
const files=['LICENSE','THIRD_PARTY_NOTICES','manifest.json','icon48.png','icon96.png','popup.html'];
const bundles=['background','kairos-bridge','canvas-content','gradescope-content','popup'].map(n=>'dist/'+n+'.js');
function check(relative,directory){
 let current=root;const parts=path.relative(root,path.join(output,relative)).split(path.sep);
 for(let i=0;i<parts.length;i++){
  current=path.join(current,parts[i]);const stat=fs.lstatSync(current,{throwIfNoEntry:false});if(!stat)continue;
  if(stat.isSymbolicLink()||(i<parts.length-1||directory?!stat.isDirectory():!stat.isFile()||stat.nlink!==1))throw new Error('Unsafe lint staging path.');
 }
}
// A separate runtime-only staging location never opens submitted ZIPs or checksums.
check('',true);for(const file of [...files,...bundles])check(file,false);
fs.mkdirSync(output,{recursive:true});
await buildFirefoxExtension({outdir:path.join(output,'dist')});
for(const name of files){check(name,false);fs.copyFileSync(path.join(root,'extension/firefox',name),path.join(output,name));}
console.log('Firefox lint runtime prepared.');
