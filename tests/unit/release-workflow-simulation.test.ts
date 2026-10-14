import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {afterEach,describe,expect,it} from 'vitest';

type Step={name?:string;run?:string;env?:Record<string,string>;id?:string};
type Job={if?:string;needs?:string;steps:Step[]};
const yaml=createRequire(import.meta.url)('js-yaml') as {load:(text:string)=>{jobs:Record<string,Job>}};
const workflow=yaml.load(fs.readFileSync('.github/workflows/deploy-production.yml','utf8'));
const root=process.cwd(),sha='a'.repeat(40),version='01234567-89ab-cdef-0123-456789abcdef';
const temporary:string[]=[];
afterEach(()=>{for(const directory of temporary.splice(0))fs.rmSync(directory,{recursive:true,force:true});});

// Run the actual YAML shell commands and release CLIs. Only package manager /
// cloud commands and fetch are replaced; this harness never reaches a service.
function simulate(scenario='success',ref='refs/heads/main'){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kairos-release-'));temporary.push(directory);
 const bin=path.join(directory,'bin');fs.mkdirSync(bin);fs.mkdirSync(path.join(directory,'dist/server'),{recursive:true});
 fs.copyFileSync('wrangler.jsonc',path.join(directory,'wrangler.jsonc'));
 const trace=path.join(directory,'trace.jsonl'),output=path.join(directory,'output');fs.writeFileSync(trace,'');fs.writeFileSync(output,'');
 const preload=path.join(directory,'fetch.mjs');
 fs.writeFileSync(preload,`
import fs from 'node:fs';
const record=value=>fs.appendFileSync(process.env.SIM_TRACE,JSON.stringify(value)+'\\n');
globalThis.fetch=async(value,options)=>{
 const url=new URL(value);record({fetch:url.origin+url.pathname});
 if(url.hostname==='api.github.com'){
  const run={id:12,run_attempt:1,head_sha:process.env.GITHUB_SHA,head_branch:'main',status:'completed',conclusion:'success',event:'push',path:'.github/workflows/milestone-2-ci.yml',head_repository:{full_name:'owner/Kairos'}};
  if(process.env.SIM_SCENARIO==='ci-failure')run.conclusion='failure';
  if(process.env.SIM_SCENARIO==='ci-wrong-sha')run.head_sha='b'.repeat(40);
  const runs=process.env.SIM_SCENARIO==='ci-pending'?[{...run,id:13,status:'in_progress',conclusion:null},run]:[run];
  return Response.json({workflow_runs:runs});
 }
 if(url.hostname.endsWith('.workers.dev')){
  if(process.env.SIM_SCENARIO==='stage-transport')throw new Error('private transport sentinel');
  if(process.env.SIM_SCENARIO==='stage-oversize')return new Response('private payload sentinel'.repeat(20));
  return process.env.SIM_SCENARIO==='stage-unhealthy'?Response.json({status:'unavailable',private:'payload sentinel'},{status:503}):Response.json({status:'ok'});
 }
 if(url.href==='https://mykairos.me/api/health')return Response.json({status:'ok'});
 throw new Error('Unexpected network request');
};
`);
 const shim=`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const command=path.basename(process.argv[1]),args=process.argv.slice(2),scenario=process.env.SIM_SCENARIO;
fs.appendFileSync(process.env.SIM_TRACE,JSON.stringify({command,args})+'\\n');
if(command==='node'){
 if(args[0]?.startsWith('scripts/'))args[0]=path.join(process.env.SIM_ROOT,args[0]);
 const result=cp.spawnSync(process.execPath,args,{env:process.env,stdio:'inherit'});process.exit(result.status??1);
}
if(command==='npm'&&args.includes('build:vinext')&&scenario==='build-failure')process.exit(1);
if(command==='npx'&&args[1]==='versions'&&args[2]==='upload'){
 if(scenario==='upload-failure')process.exit(1);
 const alias='m7-'+process.env.GITHUB_SHA.slice(0,12);
 const row={type:'version-upload',version:1,worker_name:'kairos-production',version_id:'${version}',preview_alias_url:'https://'+alias+'-kairos-production.account.workers.dev',preview_url:'https://01234567-kairos-production.account.workers.dev'};
 if(scenario==='upload-wrong-host')row.preview_alias_url='https://attacker.invalid';
 if(scenario==='upload-bad-id')row.version_id='untrusted\\nversion_id=other';
 const rows=scenario==='upload-missing'?[]:scenario==='upload-duplicate'?[row,row]:[row];
 fs.writeFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH,rows.map(r=>JSON.stringify(r)).join('\\n'));
}
if(command==='npx'&&args[1]==='d1'&&scenario==='migration-failure')process.exit(1);
`;
 for(const command of ['node','npm','npx'])fs.writeFileSync(path.join(bin,command),shim,{mode:0o755});
 const environment:NodeJS.ProcessEnv={NODE_ENV:'test',PATH:bin+path.delimiter+(process.env.PATH??''),TMPDIR:directory,
  NODE_OPTIONS:'--import '+preload,SIM_TRACE:trace,SIM_SCENARIO:scenario,SIM_ROOT:root,
  GITHUB_REF:ref,GITHUB_SHA:sha,GITHUB_REPOSITORY:'owner/Kairos',GITHUB_OUTPUT:output};
 let status=0,diagnostics='',failedStep='';
 let preflightResult='skipped';
 const allowed=(job:Job)=>{
  const expression=job.if?.match(/^\$\{\{\s*(.*?)\s*\}\}$/)?.[1];
  if(!expression)throw new Error('Missing workflow guard');
  return expression.split('&&').map(clause=>{
   if(clause.trim()==="github.ref == 'refs/heads/main'")return ref==='refs/heads/main';
   if(clause.trim()==="needs.preflight.result == 'success'")return preflightResult==='success';
   throw new Error('Unsupported workflow guard: '+clause);
  }).every(Boolean);
 };
  for(const [name,job] of [['preflight',workflow.jobs.preflight],['deploy',workflow.jobs.deploy]] as const){
   if(!allowed(job))continue;
   for(const step of job.steps){
    if(!step.run)continue;
    const interpolate=(text:string)=>text.replace(/\$\{\{\s*(.*?)\s*\}\}/g,(_match,expression:string)=>{
     if(expression==='runner.temp')return directory;
     if(expression==='github.token'||expression==='secrets.CLOUDFLARE_API_TOKEN'||expression==='secrets.CLOUDFLARE_ACCOUNT_ID')return 'dummy';
     if(expression==='secrets.CLOUDFLARE_D1_DATABASE_ID')return '11111111-1111-1111-1111-111111111111';
     if(expression==='steps.stage.outputs.version_id')return fs.readFileSync(output,'utf8').match(/^version_id=(.+)$/m)?.[1]??'';
     throw new Error('Unexpected workflow expression: '+expression);
    });
    const stepEnv=Object.fromEntries(Object.entries(step.env??{}).map(([key,value])=>[key,interpolate(value)]));
    const command=interpolate(step.run);
    const result=spawnSync('/bin/bash',['-e','-o','pipefail','-c',command],{cwd:directory,env:{...environment,...stepEnv},encoding:'utf8',timeout:20000});
    diagnostics+=result.stdout+result.stderr;
    if(result.error)throw result.error;
    if(result.status!==0){status=result.status??1;failedStep=step.name??command;break;}
   }
   if(name==='preflight')preflightResult=status===0?'success':'failure';
   if(status!==0)break;
  }
 const events=fs.readFileSync(trace,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)) as Array<{command?:string;args?:string[];fetch?:string}>;
 const cloud=events.filter(event=>event.command==='npx').map(event=>event.args!.slice(1,4).join(' '));
 return {status,failedStep,events,cloud,diagnostics,output:fs.readFileSync(output,'utf8'),directory};
}

describe.skipIf(process.platform==='win32')('offline production workflow execution',()=>{
 it('skips all production steps for a non-main ref',()=>{
  const run=simulate('success','refs/heads/feature');expect(run.status).toBe(0);expect(run.events).toEqual([]);
 });
 it.each(['ci-failure','ci-wrong-sha','ci-pending'])('rejects %s before build or upload',scenario=>{
  const run=simulate(scenario);expect(run.status).not.toBe(0);expect(run.cloud).toEqual([]);
  expect(run.events.some(event=>event.args?.includes('build:vinext'))).toBe(false);
  expect(run.diagnostics).toContain('RELEASE_CI_REQUIRED');expect(run.diagnostics).not.toContain('dummy');
 });
 it('stops on a build failure before any upload or migration',()=>{
  const run=simulate('build-failure');expect(run.status).not.toBe(0);expect(run.cloud).toEqual([]);
 });
 it.each(['upload-failure','upload-missing','upload-duplicate','upload-wrong-host','upload-bad-id','stage-unhealthy','stage-transport','stage-oversize'])('never migrates or promotes after %s',scenario=>{
  const run=simulate(scenario);expect(run.status).not.toBe(0);
  expect(run.cloud).toEqual(['versions upload --name']);expect(run.output).toBe('');
  expect(run.diagnostics).not.toMatch(/private|payload sentinel|attacker/);
 });
 it('does not promote after migration failure',()=>{
  const run=simulate('migration-failure');expect(run.status).not.toBe(0);
  expect(run.cloud).toEqual(['versions upload --name','d1 migrations apply']);
 });
 it('promotes only the checked version after staged health and migrations',()=>{
  const run=simulate();expect(run.status,run.diagnostics).toBe(0);
  expect(run.cloud).toEqual(['versions upload --name','d1 migrations apply',`versions deploy ${version}@100`]);
  expect(run.output).toBe(`version_id=${version}\n`);
  expect(run.events.filter(event=>event.fetch).map(event=>event.fetch)).toEqual([
   'https://api.github.com/repos/owner/Kairos/actions/workflows/milestone-2-ci.yml/runs',
   'https://01234567-kairos-production.account.workers.dev/api/health',
   'https://mykairos.me/api/health',
  ]);
  const config=JSON.parse(fs.readFileSync(path.join(run.directory,'.wrangler.production.jsonc'),'utf8'));
  expect(config.main).toBe('dist/server/index.js');expect(config.no_bundle).toBe(true);
  expect(config.env.production.vars.KAIROS_RELEASE_ID).toBe(sha);
 });
});
