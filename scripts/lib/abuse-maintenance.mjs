const unavailable=()=>new Error('Maintenance unavailable.');
const controlKeys=Object.freeze(['auth:initiation','auth:google','auth:microsoft-entra-id','provider:canvas','provider:gradescope','provider:ed','provider:google','provider:microsoft','provider:caldav']);
const clock="CAST(strftime('%s','now') AS INTEGER)*1000";
const iso="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const noActiveOwner=table=>`NOT EXISTS (SELECT 1 FROM operation_locks l WHERE l.user_id=${table}.user_id AND l.state IN ('running','uncertain'))`;
function changes(result,max){if(!result?.success||!Number.isSafeInteger(result.meta?.changes)||result.meta.changes<0||result.meta.changes>max)throw unavailable();return result.meta.changes;}
export async function setAbuseControl(db,{key,enabled,apply}){
  try{
    if(!controlKeys.includes(key)||typeof enabled!=='boolean'||typeof apply!=='boolean')throw unavailable();
    const changed=apply?changes(await db.prepare(`UPDATE abuse_controls SET enabled=?,version=version+1,updated_at_ms=${clock}
      WHERE control_key=? AND enabled<>? AND version<9007199254740991`).bind(enabled?1:0,key,enabled?1:0).run(),1):0;
    const row=await db.prepare('SELECT enabled,version FROM abuse_controls WHERE control_key=?').bind(key).first();
    if(!row||![0,1].includes(row.enabled)||!Number.isSafeInteger(row.version)||row.version<0||(apply&&row.enabled!==(enabled?1:0)))throw unavailable();
    return {changed,enabled:row.enabled===1,version:row.version};
  }catch{throw unavailable();}
}
export async function maintainAbuseState(db,{batchSize,apply}){
  try{
    if(!Number.isInteger(batchSize)||batchSize<1||batchSize>100||typeof apply!=='boolean')throw unavailable();
    const targets=[
      ['rateEvents','abuse_rate_events','event_id',`purge_after_ms<=${clock}`,'purge_after_ms'],
      ['runs','sync_all_runs','rowid',`expires_at_ms<=${clock} AND ${noActiveOwner('sync_all_runs')}`,'expires_at_ms'],
      ['oauthRequests','oauth_requests','rowid',`expires_at<=${iso} AND ${noActiveOwner('oauth_requests')}`,'expires_at'],
      ['bridgeRequests','sync_requests','rowid',`expires_at<=${iso} AND consumed_at IS NOT NULL AND ${noActiveOwner('sync_requests')}
        AND EXISTS (SELECT 1 FROM operation_locks l WHERE l.user_id=sync_requests.user_id AND l.operation_key=sync_requests.operation_key
          AND l.owner_nonce=sync_requests.owner_nonce AND l.state='idle')`,'expires_at'],
    ];
    const counts={};
    for(const [name,table,id,where,order] of targets){
      const selection=`SELECT ${id} FROM ${table} WHERE ${where} ORDER BY ${order},${id} LIMIT ?`;
      if(apply){
        // RETURNING counts parent rows only; D1 meta.changes may include FK cascades.
        const result=await db.prepare(`DELETE FROM ${table} WHERE ${id} IN (${selection}) RETURNING 1 AS removed`).bind(batchSize).all();
        if(!result.success||!Array.isArray(result.results)||result.results.length>batchSize||result.results.some(row=>row.removed!==1))throw unavailable();
        counts[name]=result.results.length;
      }
      else{const row=await db.prepare(`SELECT COUNT(*) AS n FROM (${selection})`).bind(batchSize).first();if(!row||!Number.isSafeInteger(row.n)||row.n<0||row.n>batchSize)throw unavailable();counts[name]=row.n;}
    }
    return counts;
  }catch{throw unavailable();}
}
/** Settlement is an operator assertion, never inferred from this database clock. */
export async function recoverOperation(db,{userId,operationKey,ownerNonce,apply,settlementConfirmed}){
  try{
    if(typeof userId!=='string'||!userId||userId.length>256||typeof ownerNonce!=='string'||!ownerNonce||ownerNonce.length>256||
      !/^(source:(canvas|ed|gradescope)|calendar:(google|microsoft|caldav))$/.test(operationKey)||typeof apply!=='boolean'||typeof settlementConfirmed!=='boolean'||(apply&&!settlementConfirmed))throw unavailable();
    const where=`user_id=? AND operation_key=? AND owner_nonce=? AND (state='uncertain' OR (state='running' AND stale_at_ms<=${clock}))
      AND EXISTS (SELECT 1 FROM abuse_controls WHERE control_key=? AND enabled=0)`;
    const params=[userId,operationKey,ownerNonce,'provider:'+operationKey.split(':')[1]];
    const eligible=(await db.prepare(`SELECT 1 AS n FROM operation_locks WHERE ${where}`).bind(...params).first())?1:0;
    const recovered=apply?changes(await db.prepare(`UPDATE operation_locks SET state='idle' WHERE ${where}`).bind(...params).run(),1):0;
    return {eligible,recovered};
  }catch{throw unavailable();}
}
