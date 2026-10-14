import {beforeEach,afterEach,expect,it} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {maintainAbuseState,recoverOperation,setAbuseControl} from '../../scripts/lib/abuse-maintenance.mjs';
import type {D1DatabaseLike} from '@/lib/db/d1/types';
let test:ReturnType<typeof openD1TestDatabase>;
beforeEach(()=>{test=openD1TestDatabase();test.sqlite.exec("INSERT INTO users(id) VALUES ('synthetic-a'),('synthetic-b')");});
afterEach(()=>test.close());
const lock=(state='uncertain',stale=0)=>test.sqlite.prepare('INSERT INTO operation_locks VALUES (?,?,?,?,?,?,?)').run('synthetic-a','source:canvas','synthetic-owner',state,0,stale,123);
it('rejects unknown controls and changes version only on enabled transitions',async()=>{
  await expect(setAbuseControl(test.db,{key:'private-control',enabled:false,apply:true})).rejects.toThrow('Maintenance unavailable.');
  expect(await setAbuseControl(test.db,{key:'auth:initiation',enabled:false,apply:false})).toEqual({changed:0,enabled:true,version:0});
  expect(await setAbuseControl(test.db,{key:'auth:initiation',enabled:false,apply:true})).toEqual({changed:1,enabled:false,version:1});
  expect(await setAbuseControl(test.db,{key:'auth:initiation',enabled:false,apply:true})).toEqual({changed:0,enabled:false,version:1});
  expect(await setAbuseControl(test.db,{key:'auth:initiation',enabled:true,apply:true})).toEqual({changed:1,enabled:true,version:2});
});
it('cleans expired rate events and runs in bounded batches while retaining live and owned runs',async()=>{
  const event=test.sqlite.prepare('INSERT INTO abuse_rate_events VALUES (?,?,?,?,?)');
  event.run('expired1','A'.repeat(43),'synthetic-b',0,1);event.run('expired2','B'.repeat(43),'synthetic-b',0,2);event.run('live','C'.repeat(43),'synthetic-b',0,9999999999999);
  const run=test.sqlite.prepare('INSERT INTO sync_all_runs VALUES (?,?,?,?)');
  run.run('synthetic-b','expired',1,'[]');run.run('synthetic-b','live',9999999999999,'[]');run.run('synthetic-a','held',1,'[]');lock('running');
  test.sqlite.prepare('INSERT INTO sync_all_steps VALUES (?,?,?,?)').run('synthetic-b','expired','ed',0);
  expect(await maintainAbuseState(test.db,{batchSize:1,apply:false})).toEqual({rateEvents:1,runs:1,oauthRequests:0,bridgeRequests:0});
  expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM abuse_rate_events').get()).toEqual({n:3});
  expect(await maintainAbuseState(test.db,{batchSize:1,apply:true})).toMatchObject({rateEvents:1,runs:1});
  expect(test.sqlite.prepare('SELECT run_id FROM sync_all_runs ORDER BY run_id').all()).toEqual([{run_id:'held'},{run_id:'live'}]);
  expect(test.sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'running'});
  expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_all_steps').get()).toEqual({n:0});
});
it('retains expired live/legacy bridge and OAuth metadata and removes only safely settled metadata',async()=>{
  lock();
  const bridge=test.sqlite.prepare(`INSERT INTO sync_requests(user_id,request_id,kind,payload_json,created_at,expires_at,consumed_at,operation_key,owner_nonce) VALUES (?,?,?,?,?,?,?,?,?)`);
  bridge.run('synthetic-a','owned','canvas_submission','{}','2000','2001','2000','source:canvas','synthetic-owner');
  bridge.run('synthetic-b','legacy','canvas_submission','{}','2000','2001',null,null,null);
  const oauth=test.sqlite.prepare(`INSERT INTO oauth_requests(user_id,state_hash,provider,code_verifier_envelope,redirect_uri,return_to,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)`);
  oauth.run('synthetic-a','held','google','synthetic','https://synthetic.invalid','/sources','2000','2001');
  oauth.run('synthetic-b','expired','google','synthetic','https://synthetic.invalid','/sources','2000','2001');
  oauth.run('synthetic-b','live','google','synthetic','https://synthetic.invalid','/sources','2000','2099-01-01');
  expect(await maintainAbuseState(test.db,{batchSize:100,apply:true})).toEqual({rateEvents:0,runs:0,oauthRequests:1,bridgeRequests:0});
  test.sqlite.exec("UPDATE operation_locks SET state='idle'");
  expect(await maintainAbuseState(test.db,{batchSize:100,apply:true})).toMatchObject({oauthRequests:1,bridgeRequests:1});
  expect(test.sqlite.prepare('SELECT request_id FROM sync_requests').all()).toEqual([{request_id:'legacy'}]);
  expect(test.sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'idle'});
});
it('recovery requires exact owner, provider pause and confirmed settlement, and retains cooldown',async()=>{
  lock();const options={userId:'synthetic-a',operationKey:'source:canvas',ownerNonce:'synthetic-owner',apply:false,settlementConfirmed:false};
  expect(await recoverOperation(test.db,options)).toEqual({eligible:0,recovered:0});
  await setAbuseControl(test.db,{key:'provider:canvas',enabled:false,apply:true});
  expect(await recoverOperation(test.db,options)).toEqual({eligible:1,recovered:0});
  await expect(recoverOperation(test.db,{...options,apply:true})).rejects.toThrow('Maintenance unavailable.');
  expect(await recoverOperation(test.db,{...options,ownerNonce:'wrong',apply:true,settlementConfirmed:true})).toEqual({eligible:0,recovered:0});
  expect(await recoverOperation(test.db,{...options,apply:true,settlementConfirmed:true})).toEqual({eligible:1,recovered:1});
  expect(test.sqlite.prepare('SELECT state,not_before_ms FROM operation_locks').get()).toEqual({state:'idle',not_before_ms:123});
});
it('never releases fresh running work; stale running work still needs operator confirmation',async()=>{
  lock('running',9999999999999);await setAbuseControl(test.db,{key:'provider:canvas',enabled:false,apply:true});
  const options={userId:'synthetic-a',operationKey:'source:canvas',ownerNonce:'synthetic-owner',apply:true,settlementConfirmed:true};
  expect(await recoverOperation(test.db,options)).toEqual({eligible:0,recovered:0});
  test.sqlite.exec('UPDATE operation_locks SET stale_at_ms=1');
  expect(await recoverOperation(test.db,options)).toEqual({eligible:1,recovered:1});
});
it('returns only finite counts and rejects unsafe batch sizes before mutation',async()=>{
  await expect(maintainAbuseState(test.db,{batchSize:10001,apply:true})).rejects.toThrow('Maintenance unavailable.');
  expect(JSON.stringify(await maintainAbuseState(test.db,{batchSize:100,apply:false}))).not.toMatch(/synthetic|user|owner|payload|envelope|http/);
});
it('recovery CAS preserves a changed owner or a provider reopened after the dry read',async()=>{
  for(const mutation of ["UPDATE operation_locks SET owner_nonce='new-owner'","UPDATE abuse_controls SET enabled=1,version=version+1 WHERE control_key='provider:canvas'"]){
    test.sqlite.exec('DELETE FROM operation_locks');lock();await setAbuseControl(test.db,{key:'provider:canvas',enabled:false,apply:true});
    const db:D1DatabaseLike={prepare(sql){const statement=test.db.prepare(sql);
      if(!sql.startsWith('UPDATE operation_locks'))return statement;
      return {bind(...params){const bound=statement.bind(...params);return {bind:bound.bind.bind(bound),first:bound.first.bind(bound),all:bound.all.bind(bound),run:async()=>{test.sqlite.exec(mutation);return bound.run();}};},first:statement.first.bind(statement),all:statement.all.bind(statement),run:statement.run.bind(statement)};
    },batch:test.db.batch.bind(test.db),exec:test.db.exec.bind(test.db)};
    expect(await recoverOperation(db,{userId:'synthetic-a',operationKey:'source:canvas',ownerNonce:'synthetic-owner',apply:true,settlementConfirmed:true})).toEqual({eligible:1,recovered:0});
    expect(test.sqlite.prepare('SELECT state FROM operation_locks').get()).toEqual({state:'uncertain'});
  }
});
