import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {expect,it} from 'vitest';

type Step={if?:string;run?:string;env?:Record<string,string>};
type Workflow={jobs:{health:{if?:string;steps:Step[]}}};
const yaml=createRequire(import.meta.url)('js-yaml') as {load:(text:string)=>Workflow};
const workflow=yaml.load(fs.readFileSync('.github/workflows/production-health.yml','utf8'));

// GitHub string equality is case-insensitive. Interpret only this workflow's
// equality/conjunction subset; the real first shell step enforces exact values.
function admitted(ref:string,enabled:string|undefined){
 const condition=workflow.jobs.health.if;
 if(condition===undefined)return true; // GitHub's default for a successful job.
 const expression=condition.match(/^\$\{\{\s*(.*?)\s*\}\}$/)?.[1];
 if(!expression)throw new Error('Unsupported health workflow condition');
 const context:Record<string,string|undefined>={'github.ref':ref,'vars.KAIROS_HEALTH_ENABLED':enabled};
 return expression.split('&&').map(clause=>{
  const match=clause.trim().match(/^([\w.]+)\s*==\s*'([^']*)'$/);
  if(!match||!Object.hasOwn(context,match[1]))throw new Error('Unsupported health workflow condition');
  return (context[match[1]]??'').toLowerCase()===match[2].toLowerCase();
 }).every(Boolean);
}

function run(ref:string,enabled:string|undefined,exerciseFailure:boolean){
 if(!admitted(ref,enabled))return {status:0,stdout:''};
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kairos-health-'));
 try{
  const preload=path.join(directory,'fetch.mjs');
  fs.writeFileSync(preload,`globalThis.fetch=async value=>{
   if(value!=='https://mykairos.me/api/health')throw new Error('Unexpected request');
   return Response.json({status:'ok'});
  };`);
  let stdout='';
  for(const step of workflow.jobs.health.steps){
   if(!step.run)continue;
   if(step.if){
    if(step.if==="${{ github.event_name == 'workflow_dispatch' && inputs.exercise_failure }}"){
     if(!exerciseFailure)continue;
    }else if(step.if==='${{ !inputs.exercise_failure }}'){
     if(exerciseFailure)continue;
    }else throw new Error('Unsupported health step condition');
   }
   const stepEnv=Object.fromEntries(Object.entries(step.env??{}).map(([name,value])=>{
    if(value!=='${{ vars.KAIROS_HEALTH_ENABLED }}')throw new Error('Unsupported health step environment');
    return [name,enabled??''];
   }));
   const result=spawnSync('/bin/bash',['-e','-o','pipefail','-c',step.run],{
    env:{...process.env,GITHUB_REF:ref,NODE_OPTIONS:'--import '+preload,...stepEnv},encoding:'utf8',timeout:15000,
   });
   if(result.error)throw result.error;
   stdout+=result.stdout;
   if(result.status!==0)return {status:result.status,stdout};
  }
  return {status:0,stdout};
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}

for(const exerciseFailure of [false,true]){
 it.skipIf(process.platform==='win32').each([
  ['refs/heads/main',undefined,0],
  ['refs/heads/main','false',0],
  ['refs/heads/feature','true',0],
  ['refs/tags/main','true',0],
  ['refs/heads/main','1',0],
  ['refs/heads/MAIN','true',1],
  ['refs/heads/main','TRUE',1],
 ] as const)(`does no health/notification work for %s with activation %s (failure exercise ${exerciseFailure})`,(ref,enabled,status)=>{
  expect(run(ref,enabled,exerciseFailure)).toEqual({status,stdout:''});
 });
 it.skipIf(process.platform==='win32')(`executes the actual YAML command after exact main activation (failure exercise ${exerciseFailure})`,()=>{
  expect(run('refs/heads/main','true',exerciseFailure)).toEqual(exerciseFailure
   ?{status:1,stdout:'{"code":"HEALTH_NOTIFICATION_TEST","status":0}\n'}
   :{status:0,stdout:'{"code":"HEALTH_OK","status":200}\n'});
 });
}
