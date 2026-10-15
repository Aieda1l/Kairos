import {build} from 'esbuild';
import {mkdir,mkdtemp,realpath,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export async function withRotationBundle(action){
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const directory=path.join(root,'artifacts','maintenance');await mkdir(directory,{recursive:true});
  const temporary=await mkdtemp(path.join(directory,'rotation-'));
  const base=await realpath(directory),original=await realpath(temporary);
  const outfile=path.join(temporary,'rotate.mjs');
  try{
  await build({absWorkingDir:root,entryPoints:['scripts/rotate-credentials-cli.ts'],outfile,bundle:true,platform:'node',target:'node22',format:'esm',logLevel:'silent',
    plugins:[{name:'operator-server-only',setup(builder){builder.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'empty'}));builder.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));}}]});
  return await action(outfile);
  }finally{
    // Verify the resolved absolute target is the exact newly created child.
    const target=await realpath(temporary);
    if(target!==original||path.dirname(target)!==base||!/^rotation-[A-Za-z0-9]+$/.test(path.basename(target)))throw new Error('Maintenance unavailable.');
    await rm(target,{recursive:true,force:true});
  }
}
