import "server-only";
import {currentOperation,operationControlVersion,OperationOwnershipError,type OperationKey} from "@/lib/abuse/operation-lock";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike,D1PreparedStatementLike} from "./types";

type SqlStructure={words:Array<{word:string;start:number;end:number}>;commas:number[]};
// The same lexical boundary rules apply to outer SET, WHERE and assignment
// separators. Literals and nested SELECTs cannot terminate an outer SET list.
function scanOuter(sql:string):SqlStructure{
  let depth=0,quote="";
  const structure:SqlStructure={words:[],commas:[]};
  for(let index=0;index<sql.length;index++){
    const char=sql[index]!;
    if(quote){if(char===quote){if(sql[index+1]===quote)index++;else quote="";}continue;}
    if(char==="'"||char==='"'){quote=char;continue;}
    if(char===";"||char==="`"||char==="["||char==="]"||sql.slice(index,index+2)==="--"||sql.slice(index,index+2)==="/*")throw new Error("Unsupported owned mutation");
    if(char==="("){depth++;continue;}
    if(char===")"){if(--depth<0)throw new Error("Unsupported owned mutation");continue;}
    if(char===","&&depth===0){structure.commas.push(index);continue;}
    if(/[A-Za-z_]/.test(char)){
      const word=sql.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)![0];
      if(depth===0){
        if(["RETURNING","LIMIT","ORDER"].includes(word.toUpperCase()))throw new Error("Unsupported owned mutation");
        structure.words.push({word:word.toUpperCase(),start:index,end:index+word.length});
      }
      index+=word.length-1;
    }
  }
  if(depth||quote)throw new Error("Unsupported owned mutation");
  return structure;
}

function wherePosition(sql:string,structure:SqlStructure,required:boolean):number{
  const clauses=structure.words.filter(token=>token.word==="WHERE");
  if(clauses.length>1||(required&&clauses.length!==1))throw new Error("Unsupported owned mutation");
  const where=clauses[0]?.start??-1;
  if(where!==-1&&!sql.slice(where+5).trim())throw new Error("Unsupported owned mutation");
  return where;
}

function outerWhere(sql:string):number{return wherePosition(sql,scanOuter(sql),true);}

// Finite writable columns from the actual repositories. Identity, provider,
// connection/assignment associations and ownership fields cannot be SET targets.
const mutableColumns:Readonly<Record<string,ReadonlySet<string>>>=Object.fromEntries(Object.entries({
  source_connections:["label","enabled","last_sync_started_at","last_sync_completed_at","last_sync_status","last_error_code","updated_at"],
  source_credentials:["canvas_feed_url_envelope","ed_api_token_envelope","updated_at"],
  source_courses:["short_name","full_name","term","year","enabled","last_seen_at","updated_at"],
  assignments:["source_kind","course_id","course_name","title","release_at","due_at","late_due_at","status","source_status_text","grade_score","grade_max","grade_display","source_url","source_updated_at","last_seen_at","updated_at"],
  submission_status_sync:["last_attempted_at","last_successful_at","last_error_code","updated_count","failed_count","updated_at"],
  assignment_submission_status:["state","is_late","is_missing","submitted_at","checked_at","extractor_version","updated_at"],
  calendar_connections:["label","enabled","account_label","remote_calendar_id","remote_calendar_name","last_sync_started_at","last_sync_completed_at","last_sync_status","last_error_code","updated_at"],
  calendar_credentials:["oauth_refresh_token_envelope","caldav_username","caldav_secret_envelope","updated_at"],
  calendar_event_links:["remote_event_id","remote_etag","content_hash","last_synced_at","last_error_code","updated_at"],
  sync_requests:["consumed_at"],
}).map(([table,columns])=>[table,new Set(columns)]));

function validateSet(sql:string,table:string):number{
  const structure=scanOuter(sql),setTokens=structure.words.filter(token=>token.word==="SET");
  if(setTokens.length!==1)throw new Error("Unsupported owned mutation");
  const start=setTokens[0]!.end,where=wherePosition(sql,structure,false),end=where===-1?sql.length:where;
  if(end<=start)throw new Error("Unsupported owned mutation");
  const separators=[...structure.commas.filter(index=>index>start&&index<end),end];
  const seen=new Set<string>();let cursor=start;
  for(const separator of separators){
    const assignment=sql.slice(cursor,separator).trim();
    const parsed=assignment.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)([\s\S]+)$/);
    const column=parsed?.[1]?.toLowerCase();
    if(!column||!parsed?.[2]?.trim()||!mutableColumns[table]?.has(column)||seen.has(column))throw new Error("Unsupported owned mutation");
    seen.add(column);cursor=separator+1;
  }
  return where;
}

export type OwnedMutationTarget=
  |{kind:"source"|"calendar";id:string;key?:OperationKey;keys?:readonly OperationKey[]}
  |{kind:"calendar-link";id:string}
  |{kind:"source-assignment";id:string;connectionId:string}
  |{kind:"bridge";id:string;key?:OperationKey};

const sourceTables=new Set(["source_connections","source_credentials","source_courses","assignments","submission_status_sync","assignment_submission_status","sync_requests"]);
const calendarTables=new Set(["calendar_connections","calendar_credentials","calendar_event_links"]);
const ownerUser="(SELECT user_id FROM kairos_owner)";
const ownerKey="(SELECT operation_key FROM kairos_owner)";
const targetId="json_extract((SELECT target_json FROM kairos_owner),'$.id')";
const targetConnection="json_extract((SELECT target_json FROM kairos_owner),'$.connectionId')";

function sourceConnection(user:string,id:string):string{
  return `EXISTS (SELECT 1 FROM source_connections resource WHERE resource.user_id=${user} AND resource.id=${id} AND 'source:'||resource.kind=${ownerKey})`;
}
function calendarConnection(user:string,id:string):string{
  return `EXISTS (SELECT 1 FROM calendar_connections resource WHERE resource.user_id=${user} AND resource.id=${id} AND 'calendar:'||resource.provider=${ownerKey})`;
}
// Guards refer to each actual candidate/existing row. A valid owner for some
// other same-user resource cannot authorize this row, including an upsert arm.
function rowGuard(table:string,row:string,target:OwnedMutationTarget):string{
  const user=`${row}.user_id`,id=`${row}.id`;
  const base=`${user}=${ownerUser} AND `;
  switch(table){
    case "source_connections":
      if(target.kind!=="source")break;
      return base+`${id}=${targetId} AND 'source:'||${row}.kind=${ownerKey}`;
    case "calendar_connections":
      if(target.kind!=="calendar")break;
      return base+`${id}=${targetId} AND 'calendar:'||${row}.provider=${ownerKey}`;
    case "source_credentials":case "source_courses":case "assignments":case "submission_status_sync":
      if(target.kind!=="source")break;
      return base+`${row}.source_connection_id=${targetId} AND ${sourceConnection(user,`${row}.source_connection_id`)}${table==="assignments"?` AND 'source:'||${row}.source_kind=${ownerKey}`:""}`;
    case "calendar_credentials":
      if(target.kind!=="calendar")break;
      return base+`${row}.calendar_connection_id=${targetId} AND ${calendarConnection(user,`${row}.calendar_connection_id`)}`;
    case "calendar_event_links":
      if(target.kind!=="calendar"&&target.kind!=="calendar-link")break;
      return base+`${target.kind==="calendar"?`${row}.calendar_connection_id` : id}=${targetId} AND ${calendarConnection(user,`${row}.calendar_connection_id`)}`;
    case "assignment_submission_status":
      if(target.kind==='source')return base+`EXISTS (SELECT 1 FROM assignments assignment JOIN source_connections resource ON resource.user_id=assignment.user_id AND resource.id=assignment.source_connection_id WHERE assignment.user_id=${user} AND assignment.id=${row}.assignment_id AND resource.id=${targetId} AND 'source:'||resource.kind=${ownerKey})`;
      if(target.kind!=="source-assignment")break;
      return base+`${row}.assignment_id=${targetId} AND EXISTS (SELECT 1 FROM assignments assignment JOIN source_connections resource ON resource.user_id=assignment.user_id AND resource.id=assignment.source_connection_id WHERE assignment.user_id=${user} AND assignment.id=${row}.assignment_id AND resource.id=${targetConnection} AND 'source:'||resource.kind=${ownerKey})`;
    case "sync_requests":
      if(target.kind!=="bridge")break;
      return base+`${row}.request_id=${targetId} AND CASE WHEN ${row}.kind='canvas_submission' THEN 'source:canvas' ELSE 'source:gradescope' END=${ownerKey} AND ${row}.operation_key=${ownerKey} AND ${row}.owner_nonce=(SELECT owner_nonce FROM kairos_owner)`;
  }
  throw new Error("Unsupported owned mutation target");
}

function auditResource(target:OwnedMutationTarget):string{
  if(target.kind==="source")return `SELECT 1 FROM source_connections resource WHERE resource.user_id=${ownerUser} AND resource.id=${targetId} AND 'source:'||resource.kind=${ownerKey}`;
  if(target.kind==="calendar")return `SELECT 1 FROM calendar_connections resource WHERE resource.user_id=${ownerUser} AND resource.id=${targetId} AND 'calendar:'||resource.provider=${ownerKey}`;
  if(target.kind==="calendar-link")return `SELECT 1 FROM calendar_event_links link JOIN calendar_connections resource ON resource.user_id=link.user_id AND resource.id=link.calendar_connection_id WHERE link.user_id=${ownerUser} AND link.id=${targetId} AND 'calendar:'||resource.provider=${ownerKey}`;
  if(target.kind==="source-assignment")return `SELECT 1 FROM assignments assignment JOIN source_connections resource ON resource.user_id=assignment.user_id AND resource.id=assignment.source_connection_id WHERE assignment.user_id=${ownerUser} AND assignment.id=${targetId} AND resource.id=${targetConnection} AND 'source:'||resource.kind=${ownerKey}`;
  return `SELECT 1 FROM sync_requests request WHERE request.user_id=${ownerUser} AND request.request_id=${targetId} AND request.operation_key=${ownerKey} AND request.owner_nonce=(SELECT owner_nonce FROM kairos_owner)`;
}

/** Actual mutation SQL authorizes nonce AND target metadata. Four fixed binds;
 * candidate CTEs keep JSON sets bounded. Unsupported shapes/targets fail closed. */
export function prepareOwned(db:D1DatabaseLike,scope:UserScope,sql:string,target?:OwnedMutationTarget):D1PreparedStatementLike{
  const lock=currentOperation(db);
  if(!lock||/^\s*SELECT\b/i.test(sql))return db.prepare(sql);
  if(!/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))throw new Error("Unsupported owned mutation");
  if(lock.userId!==scope.userId)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
  if(!target)throw new Error("Unsupported owned mutation target");
  const domain=target.kind.startsWith("calendar")?"calendar":"source";
  if(!lock.operationKey.startsWith(`${domain}:`)||("key" in target&&target.key&&target.key!==lock.operationKey)
    ||("keys" in target&&target.keys?.some(key=>key!==lock.operationKey)))throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
  const exists="EXISTS (SELECT 1 FROM kairos_owner)";
  let mutation=sql.trim();
  const table=mutation.match(/^(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_]+)\b/i)?.[1]?.toLowerCase();
  if(!table||!(sourceTables.has(table)||calendarTables.has(table)))throw new Error("Unsupported owned mutation");
  let candidate="";
  if(/^INSERT/i.test(mutation)){
    const values=mutation.match(/^(INSERT\s+INTO\s+\w+\s*\([^)]*\))\s*VALUES\s*\(([^()]*)\)([\s\S]*)$/i);
    let head="",select="",conflict="";
    if(values){head=values[1]!;select=`SELECT ${values[2]}`;conflict=values[3]!;}
    else{
      const select=mutation.match(/^(INSERT\s+INTO\s+\w+\s*\([^)]*\))\s*(SELECT[\s\S]*?)(\s+ON CONFLICT[\s\S]*)?$/i);
      if(!select)throw new Error("Unsupported owned mutation");
      head=select[1]!;conflict=select[3]??"";
      // Preserve the original SELECT, including its fixed-order bindings.
      candidate=select[2]!;
    }
    select=candidate||select!;
    const columns=head!.match(/\(([^)]*)\)\s*$/)?.[1];
    if(!columns||!/^\s*[a-z_]+(?:\s*,\s*[a-z_]+)*\s*$/i.test(columns)||/;|--|\/\*/.test(select+conflict!))throw new Error("Unsupported owned mutation");
    candidate=`, kairos_candidate(${columns}) AS (${select})`;
    if(/\bDO\s+UPDATE\s+SET\b/i.test(conflict!)){
      const where=validateSet(conflict,table);
      if(where!==-1){
        conflict=`${conflict!.slice(0,where+5)} (${conflict!.slice(where+5)}) AND (${rowGuard(table,table,target)})`;
      }else conflict+=` WHERE ${rowGuard(table,table,target)}`;
    }else if(conflict!.trim()&&!/^\s*ON\s+CONFLICT\s*\([^)]*\)\s+DO\s+NOTHING\s*$/i.test(conflict!))throw new Error("Unsupported owned mutation");
    mutation=`${head!} SELECT * FROM kairos_candidate WHERE ${exists} AND (${rowGuard(table,"kairos_candidate",target)}) ${conflict!}`;
  }else{
    const where=outerWhere(mutation);
    if(!new RegExp(`^(?:UPDATE\\s+${table}\\s+SET\\b|DELETE\\s+FROM\\s+${table}\\s+WHERE\\b)`,"i").test(mutation))throw new Error("Unsupported owned mutation");
    if(/^UPDATE/i.test(mutation))validateSet(mutation,table);
    mutation=`${mutation.slice(0,where+5)} (${mutation.slice(where+5)}) AND ${exists} AND (${rowGuard(table,table,target)})`;
  }
  const context=`WITH kairos_context AS (SELECT ? AS user_id,? AS operation_key,? AS owner_nonce,? AS target_json), kairos_owner AS (SELECT context.* FROM kairos_context context JOIN operation_locks lock ON lock.user_id=context.user_id AND lock.operation_key=context.operation_key AND lock.owner_nonce=context.owner_nonce JOIN abuse_controls control ON control.control_key='provider:'||substr(context.operation_key,instr(context.operation_key,':')+1) WHERE lock.state='running' AND control.enabled=1 AND (json_extract(context.target_json,'$.controlVersion') IS NULL OR control.version=json_extract(context.target_json,'$.controlVersion')))`;
  const ownerValues=[lock.userId,lock.operationKey,lock.ownerNonce,JSON.stringify({...target,...("keys" in target?{keys:[...new Set(target.keys)]}:{}),controlVersion:operationControlVersion(lock)??null})];
  const statement=db.prepare(`${context}${candidate} ${mutation}`);
  const bind=(...values:unknown[]):D1PreparedStatementLike=>{
    const bound=statement.bind(...ownerValues,...values),run=bound.run.bind(bound);
    // This post-denial check never authorizes a write. It makes a mismatched
    // resource a truthful rejection; stale nonce no-ops remain harmless.
    bound.run=async<T>()=>{
      const result=await run<T>();
      if(result.success&&result.meta.changes===0){
        const audit=await db.prepare(`${context} SELECT EXISTS (SELECT 1 FROM kairos_owner) AS active,EXISTS (${auditResource(target)}) AS authorized`).bind(...ownerValues).first<{active:number;authorized:number}>();
        if(audit?.active&&!audit.authorized)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
      }
      return result;
    };
    return bound;
  };
  // All callers bind their own resource/user predicates as before. The owner is
  // captured now so a delayed prepared statement cannot adopt a later owner.
  return {bind,first:()=>bind().first(),all:()=>bind().all(),run:()=>bind().run()};
}
