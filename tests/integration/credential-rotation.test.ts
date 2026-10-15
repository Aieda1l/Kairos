import {afterEach,beforeEach,expect,it} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {D1SourceConnectionRepository} from '@/lib/db/d1/repositories/source-connections';
import {D1SourceCredentialRepository} from '@/lib/db/d1/repositories/source-credentials';
import {credentialKeyringForRotation,rotateStoredCredentials} from '@/lib/security/credential-rotation';
import type {D1DatabaseLike} from '@/lib/db/d1/types';
import {D1CalendarConnectionRepository} from '@/lib/db/d1/repositories/calendar-connections';
import {D1CalendarCredentialRepository} from '@/lib/db/d1/repositories/calendar-credentials';
import {decryptCredential,encryptCredential} from '@/lib/security/credential-cipher';
const keys={v1:new Uint8Array(32).fill(1),v2:new Uint8Array(32).fill(2)};
const old={activeKeyId:'v1',keys},next={activeKeyId:'v2',keys};
const alice={userId:'synthetic-alice'},bob={userId:'synthetic-bob'};
let test:ReturnType<typeof openD1TestDatabase>,ids:string[];
beforeEach(async()=>{
  test=openD1TestDatabase();test.sqlite.exec("INSERT INTO users(id) VALUES ('synthetic-alice'),('synthetic-bob')");ids=[];
  for(const scope of [alice,bob]){
    const connection=await new D1SourceConnectionRepository(test.db,scope).upsertEd('Synthetic');ids.push(connection.id);
    await new D1SourceCredentialRepository(test.db,scope,old).setEdApiToken(connection.id,'synthetic-secret-'+scope.userId);
  }
});
afterEach(()=>test.close());
const envelopes=()=>test.sqlite.prepare('SELECT ed_api_token_envelope AS envelope FROM source_credentials ORDER BY user_id').all() as Array<{envelope:string}>;
it('cannot implicitly downgrade v2 envelopes when the maintenance active key is omitted',async()=>{
  await rotateStoredCredentials(test.db,next,{batchSize:50,dryRun:false});
  const before=envelopes();
  const bindings={KAIROS_CREDENTIAL_KEY_V1:Buffer.from(keys.v1).toString('base64url'),KAIROS_CREDENTIAL_KEY_V2:Buffer.from(keys.v2).toString('base64url')};
  expect(()=>credentialKeyringForRotation(bindings)).toThrow();
  expect(()=>credentialKeyringForRotation({...bindings,KAIROS_CREDENTIAL_ACTIVE_KEY_ID:'v1'})).toThrow();
  await expect(rotateStoredCredentials(test.db,old,{batchSize:50,dryRun:false})).rejects.toThrow();
  expect(envelopes()).toEqual(before);
  expect(credentialKeyringForRotation({...bindings,KAIROS_CREDENTIAL_ACTIVE_KEY_ID:'v2'}).activeKeyId).toBe('v2');
});
it('dry run verifies decryptability and leaves both actors envelopes unchanged',async()=>{
  const before=envelopes();
  expect(await rotateStoredCredentials(test.db,next,{batchSize:50,dryRun:true})).toEqual({scanned:2,rotated:0,conflicts:0,failed:0,remaining:2});
  expect(envelopes()).toEqual(before);
});
it('rotation resumes in bounded batches without duplicates and preserves both users decryptability',async()=>{
  expect(await rotateStoredCredentials(test.db,next,{batchSize:1,dryRun:false})).toMatchObject({scanned:1,rotated:1,remaining:1});
  expect(await rotateStoredCredentials(test.db,next,{batchSize:1,dryRun:false})).toMatchObject({scanned:1,rotated:1,remaining:0});
  expect(await rotateStoredCredentials(test.db,next,{batchSize:1,dryRun:false})).toMatchObject({scanned:0,rotated:0,remaining:0});
  for(const [index,scope] of [alice,bob].entries())expect(await new D1SourceCredentialRepository(test.db,scope,next).getEdApiToken(ids[index])).toBe('synthetic-secret-'+scope.userId);
  expect(envelopes().every(row=>row.envelope.startsWith('v1.v2.'))).toBe(true);
});
it('CAS preserves a concurrent credential replacement',async()=>{
  let replaced=false;
  const db:D1DatabaseLike={...test.db,prepare(sql){
    const statement=test.db.prepare(sql);
    if(!sql.trim().startsWith('UPDATE source_credentials'))return statement;
    return { ...statement,bind(...params){const bound=statement.bind(...params);return {
      bind:bound.bind.bind(bound),first:bound.first.bind(bound),all:bound.all.bind(bound),
      run:async()=>{
        if(!replaced){replaced=true;await new D1SourceCredentialRepository(test.db,alice,old).setEdApiToken(ids[0],'synthetic-concurrent-replacement');}
        return bound.run();
      },
    };}};
  }};
  expect(await rotateStoredCredentials(db,next,{batchSize:1,dryRun:false})).toMatchObject({rotated:0,conflicts:1,remaining:2});
  expect(await new D1SourceCredentialRepository(test.db,alice,next).getEdApiToken(ids[0])).toBe('synthetic-concurrent-replacement');
});
it('stops safely on decrypt failure without returning rows or secret content',async()=>{
  test.sqlite.prepare('UPDATE source_credentials SET ed_api_token_envelope=? WHERE user_id=?').run('malformed-envelope',alice.userId);
  const result=await rotateStoredCredentials(test.db,next,{batchSize:50,dryRun:false});
  expect(result).toMatchObject({failed:1,rotated:0,remaining:2});
  expect(Object.keys(result).sort()).toEqual(['conflicts','failed','remaining','rotated','scanned']);
  expect(JSON.stringify(result)).not.toMatch(/synthetic|malformed|envelope/);
});
it('rotates every finite envelope kind with its original actor/purpose/context AAD',async()=>{
  const canvas=await new D1SourceConnectionRepository(test.db,alice).upsertCanvas('Synthetic');
  await new D1SourceCredentialRepository(test.db,alice,old).setCanvasFeedUrl(canvas.id,'https://canvas.uw.edu/feeds/calendars/synthetic.ics');
  const calendars=new D1CalendarConnectionRepository(test.db,alice);
  const ids:Record<string,string>={};
  for(const provider of ['google','microsoft','caldav'] as const){
    const connection=await calendars.create({provider,label:'Synthetic'});ids[provider]=connection.id;
    const credentials=new D1CalendarCredentialRepository(test.db,alice,old);
    if(provider==='caldav')await credentials.setCaldavCredentials(connection.id,'synthetic@example.invalid','synthetic-caldav-secret');
    else await credentials.setOAuthRefreshToken(connection.id,'synthetic-'+provider+'-refresh');
  }
  const state=Buffer.from(new Uint8Array(32).fill(3)).toString('base64url');
  const pkce=await encryptCredential({plaintext:'synthetic-pkce',userId:alice.userId,purpose:'oauth_pkce_verifier',contextId:state},old);
  test.sqlite.prepare(`INSERT INTO oauth_requests(user_id,state_hash,provider,code_verifier_envelope,redirect_uri,return_to,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(alice.userId,state,'google',pkce,'https://synthetic.invalid/callback','/sources',new Date().toISOString(),'2099-01-01T00:00:00.000Z');
  const draft=await encryptCredential({plaintext:'synthetic-draft-json',userId:alice.userId,purpose:'onboarding_draft',contextId:'onboarding:caldav'},old);
  test.sqlite.prepare('INSERT INTO app_settings(user_id,key,value,updated_at) VALUES (?,?,?,?)').run(alice.userId,'onboarding_draft:caldav',draft,new Date().toISOString());
  expect(await rotateStoredCredentials(test.db,next,{batchSize:50,dryRun:false})).toEqual({scanned:8,rotated:8,conflicts:0,failed:0,remaining:0});
  const read=new D1CalendarCredentialRepository(test.db,alice,next);
  expect(await read.getOAuthRefreshToken(ids.google)).toBe('synthetic-google-refresh');
  expect(await read.getOAuthRefreshToken(ids.microsoft)).toBe('synthetic-microsoft-refresh');
  expect(await read.getCaldavCredentials(ids.caldav)).toEqual({username:'synthetic@example.invalid',secret:'synthetic-caldav-secret'});
  const pkceAfter=(test.sqlite.prepare('SELECT code_verifier_envelope AS envelope FROM oauth_requests WHERE user_id=? AND state_hash=?').get(alice.userId,state) as {envelope:string}).envelope;
  expect(await decryptCredential({envelope:pkceAfter,userId:alice.userId,purpose:'oauth_pkce_verifier',contextId:state},next)).toBe('synthetic-pkce');
  const draftAfter=(test.sqlite.prepare('SELECT value AS envelope FROM app_settings WHERE user_id=? AND key=?').get(alice.userId,'onboarding_draft:caldav') as {envelope:string}).envelope;
  expect(await decryptCredential({envelope:draftAfter,userId:alice.userId,purpose:'onboarding_draft',contextId:'onboarding:caldav'},next)).toBe('synthetic-draft-json');
});
it('cannot recreate a draft discarded or completed during rotation',async()=>{
  const value=await encryptCredential({plaintext:'synthetic-draft',userId:alice.userId,purpose:'onboarding_draft',contextId:'onboarding:canvas'},old);
  test.sqlite.prepare('INSERT INTO app_settings VALUES (?,?,?,?)').run(alice.userId,'onboarding_draft:canvas',value,new Date().toISOString());
  // Clear earlier targets so the only candidate is the in-flight draft.
  test.sqlite.exec('DELETE FROM source_credentials');
  const db:D1DatabaseLike={prepare(sql){
    const statement=test.db.prepare(sql);
    if(!sql.trim().startsWith('UPDATE app_settings'))return statement;
    return {bind(...params){const bound=statement.bind(...params);return {bind:bound.bind.bind(bound),first:bound.first.bind(bound),all:bound.all.bind(bound),run:async()=>{
      test.sqlite.prepare('DELETE FROM app_settings WHERE user_id=? AND key=?').run(alice.userId,'onboarding_draft:canvas');
      return bound.run();
    }};},first:statement.first.bind(statement),all:statement.all.bind(statement),run:statement.run.bind(statement)};
  },batch:test.db.batch.bind(test.db),exec:test.db.exec.bind(test.db)};
  expect(await rotateStoredCredentials(db,next,{batchSize:50,dryRun:false})).toEqual({scanned:1,rotated:0,conflicts:1,failed:0,remaining:0});
  expect(test.sqlite.prepare('SELECT COUNT(*) AS n FROM app_settings').get()).toEqual({n:0});
});
it('expired PKCE is not rotated and remains an old-key dependency until safe cleanup',async()=>{
  const state='synthetic-expired-state';
  const value=await encryptCredential({plaintext:'synthetic-pkce',userId:alice.userId,purpose:'oauth_pkce_verifier',contextId:state},old);
  test.sqlite.prepare(`INSERT INTO oauth_requests(user_id,state_hash,provider,code_verifier_envelope,redirect_uri,return_to,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(alice.userId,state,'google',value,'https://synthetic.invalid','/sources','2000','2001');
  expect(await rotateStoredCredentials(test.db,next,{batchSize:50,dryRun:false})).toEqual({scanned:2,rotated:2,conflicts:0,failed:0,remaining:1});
  expect(test.sqlite.prepare('SELECT code_verifier_envelope FROM oauth_requests').get()).toEqual({code_verifier_envelope:value});
});
it('round-trips all three draft contexts for both users through forward rotation',async()=>{
  const drafts=[{kind:'canvas',feedUrl:'https://canvas.uw.edu/feeds/calendars/synthetic.ics'},
    {kind:'ed',token:'synthetic-ed-token'},{kind:'caldav',username:'synthetic@example.invalid',secret:'synthetic-caldav'}];
  for(const scope of [alice,bob])for(const draft of drafts){
    const plaintext=JSON.stringify(draft),envelope=await encryptCredential({plaintext,userId:scope.userId,purpose:'onboarding_draft',contextId:'onboarding:'+draft.kind},old);
    test.sqlite.prepare('INSERT INTO app_settings VALUES (?,?,?,?)').run(scope.userId,'onboarding_draft:'+draft.kind,envelope,new Date().toISOString());
  }
  expect(await rotateStoredCredentials(test.db,next,{batchSize:50,dryRun:false})).toEqual({scanned:8,rotated:8,conflicts:0,failed:0,remaining:0});
  for(const scope of [alice,bob])for(const draft of drafts){
    const row=test.sqlite.prepare('SELECT value AS envelope FROM app_settings WHERE user_id=? AND key=?').get(scope.userId,'onboarding_draft:'+draft.kind) as {envelope:string};
    expect(await decryptCredential({envelope:row.envelope,userId:scope.userId,purpose:'onboarding_draft',contextId:'onboarding:'+draft.kind},next)).toBe(JSON.stringify(draft));
  }
});
