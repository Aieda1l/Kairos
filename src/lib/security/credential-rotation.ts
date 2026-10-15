import 'server-only';
import type {D1DatabaseLike} from '@/lib/db/d1/types';
import {decryptCredential,encryptCredential,CredentialKeyConfigurationError,type CredentialKeyring,type SecretPurpose} from './credential-cipher';
import {credentialKeyringFromBindings} from './keyring-environment';
export type RotationCounts={scanned:number;rotated:number;conflicts:number;failed:number;remaining:number};
/** This release only supports forward v1-to-v2 migration, never implicit rollback. */
export function credentialKeyringForRotation(env:Record<string,unknown>):CredentialKeyring{
  if(env.KAIROS_CREDENTIAL_ACTIVE_KEY_ID!=='v2')throw new Error('Explicit v2 rotation target required.');
  return credentialKeyringFromBindings(env);
}
type Target={table:string;column:string;id:string;purpose:string;context?:string;join?:string;scan?:string;where?:string};
const targets:readonly Target[]=[
  {table:'source_credentials',column:'canvas_feed_url_envelope',id:'source_connection_id',purpose:"'canvas_feed_url'"},
  {table:'source_credentials',column:'ed_api_token_envelope',id:'source_connection_id',purpose:"'ed_api_token'"},
  {table:'calendar_credentials',column:'oauth_refresh_token_envelope',id:'calendar_connection_id',
    purpose:"CASE c.provider WHEN 'google' THEN 'google_refresh_token' WHEN 'microsoft' THEN 'microsoft_refresh_token' ELSE 'unsupported' END",
    join:'JOIN calendar_connections c ON c.user_id=t.user_id AND c.id=t.calendar_connection_id'},
  {table:'calendar_credentials',column:'caldav_secret_envelope',id:'calendar_connection_id',purpose:"'caldav_secret'"},
  {table:'oauth_requests',column:'code_verifier_envelope',id:'state_hash',purpose:"'oauth_pkce_verifier'",
    scan:"AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')"},
  {table:'app_settings',column:'value',id:'key',purpose:"'onboarding_draft'",
    where:"AND t.key IN ('onboarding_draft:canvas','onboarding_draft:ed','onboarding_draft:caldav')",
    context:"CASE t.key WHEN 'onboarding_draft:canvas' THEN 'onboarding:canvas' WHEN 'onboarding_draft:ed' THEN 'onboarding:ed' WHEN 'onboarding_draft:caldav' THEN 'onboarding:caldav' END"},
];
const purposes=new Set<SecretPurpose>(['canvas_feed_url','ed_api_token','google_refresh_token','microsoft_refresh_token','caldav_secret','oauth_pkce_verifier','onboarding_draft']);
type Row={userId:string;id:string;contextId:string;purpose:SecretPurpose;envelope:string};
const predicate=(target:Target)=>`t.${target.column} IS NOT NULL AND t.${target.column}<>'' AND substr(t.${target.column},1,?)<>? ${target.where??''}`;
async function remaining(db:D1DatabaseLike,prefix:string):Promise<number>{
  let count=0;
  for(const target of targets){
    // Expired PKCE envelopes still count as old-key dependencies until safely
    // cleaned up; expiry alone must not authorize removal of their read key.
    const row=await db.prepare(`SELECT COUNT(*) AS n FROM ${target.table} t ${target.join??''} WHERE ${predicate(target)}`)
      .bind(prefix.length,prefix).first<{n:number}>();
    if(!row||!Number.isSafeInteger(row.n)||row.n<0)throw new Error('Credential maintenance unavailable.');
    count+=row.n;
  }
  return count;
}
export async function rotateStoredCredentials(db:D1DatabaseLike,keyring:CredentialKeyring,options:{batchSize:number;dryRun:boolean}):Promise<RotationCounts>{
  if(keyring.activeKeyId!=='v2')throw new Error('Explicit v2 rotation target required.');
  if(!Number.isInteger(options.batchSize)||options.batchSize<1||options.batchSize>100||typeof options.dryRun!=='boolean')throw new Error('Invalid credential maintenance options.');
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(keyring.activeKeyId)||keyring.keys[keyring.activeKeyId]?.byteLength!==32)throw new CredentialKeyConfigurationError('Credential key configuration is invalid.');
  const prefix=`v1.${keyring.activeKeyId}.`;
  const counts:RotationCounts={scanned:0,rotated:0,conflicts:0,failed:0,remaining:0};
  try{
    outer:for(const target of targets){
      const room=options.batchSize-counts.scanned;if(room<=0)break;
      const rows=await db.prepare(`SELECT t.user_id AS userId,t.${target.id} AS id,t.${target.column} AS envelope,
        ${target.purpose} AS purpose,${target.context??`t.${target.id}`} AS contextId
        FROM ${target.table} t ${target.join??''} WHERE ${predicate(target)} ${target.scan??''}
        ORDER BY t.user_id,t.${target.id} LIMIT ?`).bind(prefix.length,prefix,room).all<Row>();
      if(!rows.success||rows.results.length>room)throw new Error('Credential maintenance unavailable.');
      for(const row of rows.results){
        counts.scanned++;
        let replacement:string;
        try{
          if(!purposes.has(row.purpose)||!row.userId||!row.id||!row.contextId||typeof row.envelope!=='string')throw new Error();
          const plaintext=await decryptCredential({envelope:row.envelope,userId:row.userId,purpose:row.purpose,contextId:row.contextId},keyring);
          if(options.dryRun)continue;
          replacement=await encryptCredential({plaintext,userId:row.userId,purpose:row.purpose,contextId:row.contextId},keyring);
        }catch{counts.failed++;break outer;}
        // UPDATE-only CAS cannot recreate a discarded draft/deleted account,
        // or overwrite a credential replaced while crypto work was in flight.
        const result=await db.prepare(`UPDATE ${target.table} SET ${target.column}=?
          WHERE user_id=? AND ${target.id}=? AND ${target.column}=?`)
          .bind(replacement,row.userId,row.id,row.envelope).run();
        const changed=result.meta.changes;
        if(!result.success||typeof changed!=='number'||!Number.isInteger(changed)||changed<0||changed>1)throw new Error('Credential maintenance unavailable.');
        if(changed===1)counts.rotated++;else counts.conflicts++;
      }
    }
    counts.remaining=await remaining(db,prefix);
    return counts;
  }catch{throw new Error('Credential maintenance unavailable.');}
}
