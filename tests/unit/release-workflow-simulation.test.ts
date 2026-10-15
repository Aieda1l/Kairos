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
 fs.cpSync('migrations',path.join(directory,'migrations'),{recursive:true});
 const trace=path.join(directory,'trace.jsonl'),output=path.join(directory,'output');fs.writeFileSync(trace,'');fs.writeFileSync(output,'');
 const cloudState=path.join(directory,'cloud.json');
 fs.writeFileSync(cloudState,JSON.stringify({schema:1,traffic:'previous-version',users:['dummy-user']}));
 const preload=path.join(directory,'fetch.mjs');
 fs.writeFileSync(preload,`
import fs from 'node:fs';
const record=value=>fs.appendFileSync(process.env.SIM_TRACE,JSON.stringify(value)+'\\n');
globalThis.fetch=async(value,options)=>{
 const url=new URL(value);record({fetch:url.origin+url.pathname});
 if(url.hostname==='api.cloudflare.com'){
  const state=JSON.parse(fs.readFileSync(process.env.SIM_STATE,'utf8'));
  if(url.pathname.endsWith('/workers/subdomain'))return Response.json({success:true,result:{subdomain:'account'}});
  const names=['0001_auth.sql','0002_kairos_tenant_schema.sql','0003_identity_token_minimization.sql','0004_onboarding_state.sql','0005_abuse_controls.sql','0006_bridge_ownership.sql','0007_provider_admission.sql'];
  if(url.pathname.endsWith('/query')){
   const count=state.schema===2&&process.env.SIM_SCENARIO!=='migration-result-incomplete'?7:3;
   const rows=names.slice(0,count);if(process.env.SIM_SCENARIO==='baseline-drift'||(process.env.KAIROS_VERSION_ID&&state.schema===1&&process.env.SIM_SCENARIO==='schema-drift-after-upload'))rows.push('unexpected.sql');
   return Response.json({success:true,result:[{success:true,results:rows.map(name=>({name})),meta:{rows_written:0}}]});
  }
  if(url.pathname.endsWith('/deployments')){
   const drift=process.env.KAIROS_VERSION_ID&&((state.schema===1&&process.env.SIM_SCENARIO==='active-drift-after-upload')||(state.schema===2&&process.env.SIM_SCENARIO==='active-drift-after-migrate'));
   return Response.json({success:true,result:{deployments:[{versions:[{version_id:drift?'11111111-2222-3333-4444-555555555555':'fedcba98-7654-3210-fedc-ba9876543210',percentage:100}]}]}});
  }
  if(url.pathname.endsWith('/script-settings'))return Response.json({success:true,result:{observability:process.env.SIM_SCENARIO==='stage-logging'?{enabled:true}:null,logpush:false,tail_consumers:[]}});
  if(url.pathname.includes('/versions/')){
   const secretNames=['AUTH_SECRET','AUTH_GOOGLE_ID','AUTH_GOOGLE_SECRET','AUTH_MICROSOFT_ENTRA_ID_ID','AUTH_MICROSOFT_ENTRA_ID_SECRET','GOOGLE_CALENDAR_CLIENT_ID','GOOGLE_CALENDAR_CLIENT_SECRET','MICROSOFT_CALENDAR_CLIENT_ID','MICROSOFT_CALENDAR_CLIENT_SECRET','MICROSOFT_CALENDAR_TENANT','KAIROS_CREDENTIAL_KEY_V1','KAIROS_TURNSTILE_SITE_KEY','KAIROS_TURNSTILE_SECRET_KEY','KAIROS_ABUSE_KEY_V1'];
   const bindings=[...secretNames.map(name=>({name,type:'secret_text'})),{name:'DB',type:'d1',id:'11111111-1111-1111-1111-111111111111'},
    ...Object.entries({KAIROS_APP_URL:'https://mykairos.me',AUTH_URL:'https://mykairos.me',KAIROS_ABUSE_TRUSTED_INGRESS:'cloudflare',KAIROS_RELEASE_ID:process.env.GITHUB_SHA}).map(([name,text])=>({name,type:'plain_text',text}))];
   if(process.env.SIM_SCENARIO==='stage-config-failure'||(state.schema===2&&process.env.SIM_SCENARIO==='config-drift-after-migrate'))bindings.push({name:'E2E_FIXTURES',type:'plain_text',text:'1'});
   if(process.env.SIM_SCENARIO==='stage-wrong-db')bindings.find(b=>b.name==='DB').id='22222222-2222-2222-2222-222222222222';
   if(process.env.SIM_SCENARIO==='stage-wrong-release')bindings.find(b=>b.name==='KAIROS_RELEASE_ID').text='b'.repeat(40);
   if(process.env.SIM_SCENARIO==='stage-missing-secret')bindings.splice(bindings.findIndex(b=>b.name==='KAIROS_CREDENTIAL_KEY_V1'),1);
   return Response.json({success:true,result:{id:'${version}',resources:{bindings,script_runtime:{compatibility_date:'2026-10-06',compatibility_flags:['nodejs_compat']}}}});
  }
  throw new Error('Unexpected Cloudflare request');
 }
 if(url.hostname==='api.github.com'){
  const run={id:12,run_attempt:1,head_sha:process.env.GITHUB_SHA,head_branch:'main',status:'completed',conclusion:'success',event:'push',path:'.github/workflows/milestone-2-ci.yml',head_repository:{full_name:'owner/Kairos'}};
  if(process.env.SIM_SCENARIO==='ci-failure')run.conclusion='failure';
  if(process.env.SIM_SCENARIO==='ci-wrong-sha')run.head_sha='b'.repeat(40);
  const runs=process.env.SIM_SCENARIO==='ci-pending'?[{...run,id:13,status:'in_progress',conclusion:null},run]:[run];
  return Response.json({workflow_runs:process.env.SIM_SCENARIO==='ci-missing'?[]:runs});
 }
 if(url.hostname.endsWith('.workers.dev')){
  if(url.pathname!=='/api/health')return process.env.SIM_SCENARIO==='stage-open'
   ?Response.json({status:'ok'}):Response.json({code:'PREVIEW_HEALTH_ONLY'},{status:404});
  if(process.env.SIM_SCENARIO==='stage-transport')throw new Error('private transport sentinel');
  if(process.env.SIM_SCENARIO==='stage-oversize')return new Response('private payload sentinel'.repeat(20));
  return process.env.SIM_SCENARIO==='stage-unhealthy'?Response.json({status:'unavailable',private:'payload sentinel'},{status:503}):Response.json({status:'ok'});
 }
 if(url.href==='https://mykairos.me/api/health')return process.env.SIM_SCENARIO==='production-unhealthy'
  ?Response.json({status:'unavailable'},{status:503}):Response.json({status:'ok'});
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
if(command==='npx'&&args[1]==='d1'){
 if(scenario==='migration-failure')process.exit(1);
 const state=JSON.parse(fs.readFileSync(process.env.SIM_STATE,'utf8'));state.schema=2;fs.writeFileSync(process.env.SIM_STATE,JSON.stringify(state));
}
if(command==='npx'&&args[1]==='versions'&&args[2]==='deploy'){
 if(scenario==='promotion-failure')process.exit(1);
 const state=JSON.parse(fs.readFileSync(process.env.SIM_STATE,'utf8'));state.traffic=args[3].split('@')[0];fs.writeFileSync(process.env.SIM_STATE,JSON.stringify(state));
}
`;
 for(const command of ['node','npm','npx'])fs.writeFileSync(path.join(bin,command),shim,{mode:0o755});
 const environment:NodeJS.ProcessEnv={NODE_ENV:'test',PATH:bin+path.delimiter+(process.env.PATH??''),TMPDIR:directory,
  NODE_OPTIONS:'--import '+preload,SIM_TRACE:trace,SIM_SCENARIO:scenario,SIM_ROOT:root,SIM_STATE:cloudState,
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
     if(expression==='github.token'||expression==='secrets.CLOUDFLARE_API_TOKEN')return 'dummy';
     if(expression==='secrets.CLOUDFLARE_ACCOUNT_ID')return 'a'.repeat(32);
     if(expression==='inputs.expected_active_version')return 'fedcba98-7654-3210-fedc-ba9876543210';
     if(expression==='secrets.CLOUDFLARE_D1_DATABASE_ID')return '11111111-1111-1111-1111-111111111111';
     if(expression==='steps.stage.outputs.version_id')return fs.readFileSync(output,'utf8').match(/^version_id=(.+)$/m)?.[1]??'';
     if(expression==='steps.baseline.outputs.workers_subdomain')return fs.readFileSync(output,'utf8').match(/^workers_subdomain=(.+)$/m)?.[1]??'';
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
 return {status,failedStep,events,cloud,diagnostics,output:fs.readFileSync(output,'utf8'),directory,state:JSON.parse(fs.readFileSync(cloudState,'utf8'))};
}

describe.skipIf(process.platform==='win32')('offline production workflow execution',()=>{
 it.each(['active-drift-after-upload','schema-drift-after-upload','active-drift-after-migrate','config-drift-after-migrate'])('withholds the next mutation after %s',scenario=>{
  const run=simulate(scenario);expect(run.status).not.toBe(0);
  const migrated=scenario.endsWith('-migrate');
  expect(run.cloud).toEqual(migrated?['versions upload --name','d1 migrations apply']:['versions upload --name']);
  expect(run.state).toEqual({schema:migrated?2:1,traffic:'previous-version',users:['dummy-user']});
 });
 it.each(['baseline-drift','stage-config-failure','stage-wrong-db','stage-wrong-release','stage-missing-secret','stage-logging','stage-open','migration-result-incomplete'])('stops on %s before the next production mutation',scenario=>{
  const run=simulate(scenario);expect(run.status).not.toBe(0);
  expect(run.cloud).toEqual(['baseline-drift','stage-logging'].includes(scenario)?[]:scenario==='migration-result-incomplete'?['versions upload --name','d1 migrations apply']:['versions upload --name']);
  expect(run.state.traffic).toBe('previous-version');
 });
 it('skips all production steps for a non-main ref',()=>{
  const run=simulate('success','refs/heads/feature');expect(run.status).toBe(0);expect(run.events).toEqual([]);
 });
 it.each(['ci-failure','ci-wrong-sha','ci-pending','ci-missing'])('rejects %s before build or upload',scenario=>{
  const run=simulate(scenario);expect(run.status).not.toBe(0);expect(run.cloud).toEqual([]);
  expect(run.events.some(event=>event.args?.includes('build:vinext'))).toBe(false);
  expect(run.diagnostics).toContain('RELEASE_CI_REQUIRED');expect(run.diagnostics).not.toContain('dummy');
 });
 it('stops on a build failure before any upload or migration',()=>{
  const run=simulate('build-failure');expect(run.status).not.toBe(0);expect(run.cloud).toEqual([]);
 });
 it.each(['upload-failure','upload-missing','upload-duplicate','upload-wrong-host','upload-bad-id','stage-unhealthy','stage-transport','stage-oversize'])('never migrates or promotes after %s',scenario=>{
  const run=simulate(scenario);expect(run.status).not.toBe(0);
  expect(run.cloud).toEqual(['versions upload --name']);expect(run.output).toBe('workers_subdomain=account\n');
  expect(run.diagnostics).not.toMatch(/private|payload sentinel|attacker/);
 });
 it('does not promote after migration failure',()=>{
  const run=simulate('migration-failure');expect(run.status).not.toBe(0);
  expect(run.cloud).toEqual(['versions upload --name','d1 migrations apply']);
 });
 it('retains the applied schema and prior traffic after a failed promotion',()=>{
  const run=simulate('promotion-failure');expect(run.status).not.toBe(0);
  expect(run.cloud).toEqual(['versions upload --name','d1 migrations apply',`versions deploy ${version}@100`]);
  expect(run.state).toEqual({schema:2,traffic:'previous-version',users:['dummy-user']});
  expect(run.events.some(event=>event.fetch==='https://mykairos.me/api/health')).toBe(false);
 });
 it('reports post-promotion health failure without issuing an unreviewed rollback',()=>{
  const run=simulate('production-unhealthy');expect(run.status).not.toBe(0);
  expect(run.cloud).toEqual(['versions upload --name','d1 migrations apply',`versions deploy ${version}@100`]);
  expect(run.state).toEqual({schema:2,traffic:version,users:['dummy-user']});
  expect(run.diagnostics).toContain('HEALTH_CHECK_FAILED');
 });
 it('promotes only the checked version after staged health and migrations',()=>{
  const run=simulate();expect(run.status,run.diagnostics).toBe(0);
  expect(run.cloud).toEqual(['versions upload --name','d1 migrations apply',`versions deploy ${version}@100`]);
  expect(run.output).toBe(`workers_subdomain=account\nversion_id=${version}\n`);
  expect(run.events.filter(event=>event.fetch&&!event.fetch.startsWith('https://api.cloudflare.com/')).map(event=>event.fetch)).toEqual([
   'https://api.github.com/repos/owner/Kairos/actions/workflows/milestone-2-ci.yml/runs',
   'https://01234567-kairos-production.account.workers.dev/api/health',
   'https://01234567-kairos-production.account.workers.dev/onboarding',
   'https://01234567-kairos-production.account.workers.dev/api/auth/providers',
   'https://mykairos.me/api/health',
  ]);
  expect(run.events.filter(event=>event.command==='node'&&event.args?.[0]==='scripts/verify-release-state.mjs').map(event=>event.args?.[1]))
   .toEqual(['baseline','staged','migrated']);
  const config=JSON.parse(fs.readFileSync(path.join(run.directory,'.wrangler.production.jsonc'),'utf8'));
  expect(config.main).toBe('dist/server/index.js');expect(config.no_bundle).toBe(true);
  expect(config.env.production.vars.KAIROS_RELEASE_ID).toBe(sha);
 });
});
