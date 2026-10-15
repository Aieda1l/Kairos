import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';
it('fresh lint preparation cannot overwrite submitted release ZIPs',()=>{
 const directory=fs.mkdtempSync(path.join(tmpdir(),'kairos-lint-isolation-'));
 try{
  for(const relative of ['scripts/build-firefox-extension.mjs','scripts/prepare-firefox-lint.mjs','tsconfig.json','src','extension/firefox']){
   const target=path.join(directory,relative);fs.mkdirSync(path.dirname(target),{recursive:true});
   if(fs.existsSync(relative))fs.cpSync(relative,target,{recursive:true});
  }
  fs.symlinkSync(path.join(process.cwd(),'node_modules'),path.join(directory,'node_modules'),'junction');
  const artifacts=path.join(directory,'artifacts/firefox');fs.mkdirSync(artifacts,{recursive:true});
  const names=['kairos-bridge-0.4.0.zip','kairos-bridge-0.4.0-source.zip'];
  for(const name of names)fs.writeFileSync(path.join(artifacts,name),'immutable-submitted-'+name);
  const result=spawnSync(process.execPath,['scripts/prepare-firefox-lint.mjs'],{cwd:directory,encoding:'utf8'});
  expect(result.status).toBe(0);
  for(const name of names)expect(fs.readFileSync(path.join(artifacts,name),'utf8')).toBe('immutable-submitted-'+name);
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'artifacts/firefox-lint/manifest.json'),'utf8'));
  expect(manifest.version).toBe('0.4.0');expect(fs.existsSync(path.join(directory,'artifacts/firefox-lint/dist/background.js'))).toBe(true);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
