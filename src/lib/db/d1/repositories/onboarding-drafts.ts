import "server-only";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike,D1PreparedStatementLike} from "@/lib/db/d1/types";
import {currentOperation,operationControlVersion,OperationOwnershipError} from "@/lib/abuse/operation-lock";
import {decryptCredential,encryptCredential,type CredentialKeyring} from "@/lib/security/credential-cipher";
import {ONBOARDING_DRAFT_MAX_PAYLOAD_BYTES,validateSecretDraft,type SecretDraft} from "@/lib/onboarding/secret-draft";
import {D1OnboardingRepository,OnboardingConflictError} from "./onboarding";

const keys={canvas:"onboarding_draft:canvas",ed:"onboarding_draft:ed",caldav:"onboarding_draft:caldav"} as const;
const keyList="'onboarding_draft:canvas','onboarding_draft:ed','onboarding_draft:caldav'";
export type SavedDraftMetadata={kind:SecretDraft["kind"];saved:true};

export class D1OnboardingDraftRepository{
  constructor(private readonly db:D1DatabaseLike,private readonly scope:UserScope,private readonly keyring?:CredentialKeyring){}

  async availability():Promise<SavedDraftMetadata[]>{
    const result=await this.db.prepare(`SELECT key FROM app_settings WHERE user_id=? AND key IN (${keyList})`)
      .bind(this.scope.userId).all<{key:string}>();
    return (Object.keys(keys) as SecretDraft["kind"][]).filter(kind=>result.results.some(row=>row.key===keys[kind]))
      .map(kind=>({kind,saved:true}));
  }

  async save(input:SecretDraft):Promise<SavedDraftMetadata>{
    const draft=validateSecretDraft(input);
    if(!this.keyring)throw new Error("Credential keyring required.");
    await new D1OnboardingRepository(this.db,this.scope).ensureInitialized();
    const envelope=await encryptCredential({plaintext:JSON.stringify(draft),userId:this.scope.userId,
      purpose:"onboarding_draft",contextId:`onboarding:${draft.kind}`},this.keyring);
    // Finish and save may race; the storage write itself checks terminal state.
    const result=await this.db.prepare(`
      INSERT INTO app_settings(user_id,key,value,updated_at)
      SELECT user_id,?,?,? FROM app_settings
      WHERE user_id=? AND key='onboarding' AND json_extract(value,'$.status')<>'completed'
      ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
    `).bind(keys[draft.kind],envelope,new Date().toISOString(),this.scope.userId).run();
    if(result.meta.changes!==1)throw new OnboardingConflictError();
    return {kind:draft.kind,saved:true};
  }

  async envelope(kind:SecretDraft["kind"]):Promise<string|null>{
    const row=await this.db.prepare("SELECT value FROM app_settings WHERE user_id=? AND key=?")
      .bind(this.scope.userId,keys[kind]).first<{value:string}>();
    return row?.value??null;
  }

  async read(kind:SecretDraft["kind"]):Promise<{draft:SecretDraft;envelope:string}|null>{
    const envelope=await this.envelope(kind);
    if(envelope===null)return null;
    if(!this.keyring||envelope.length>ONBOARDING_DRAFT_MAX_PAYLOAD_BYTES*2)throw new Error("Invalid stored setup candidate.");
    const plaintext=await decryptCredential({envelope,userId:this.scope.userId,purpose:"onboarding_draft",contextId:`onboarding:${kind}`},this.keyring);
    if(new TextEncoder().encode(plaintext).byteLength>ONBOARDING_DRAFT_MAX_PAYLOAD_BYTES)throw new Error("Invalid stored setup candidate.");
    const draft=validateSecretDraft(JSON.parse(plaintext));
    if(draft.kind!==kind)throw new Error("Invalid stored setup candidate.");
    return {draft,envelope};
  }

  prepareDiscard(kind:SecretDraft["kind"],expectedEnvelope?:string|null):D1PreparedStatementLike{
    const statement=this.db.prepare(`DELETE FROM app_settings WHERE user_id=? AND key=?${expectedEnvelope===undefined?"":" AND value=?"}`);
    return expectedEnvelope===undefined?statement.bind(this.scope.userId,keys[kind]):statement.bind(this.scope.userId,keys[kind],expectedEnvelope);
  }
  async discard(kind:SecretDraft["kind"]):Promise<void>{await this.prepareDiscard(kind).run();}

  prepareAcceptedCleanup(kind:SecretDraft["kind"],expectedEnvelope:string|null):D1PreparedStatementLike{
    const lock=currentOperation(this.db),version=lock&&operationControlVersion(lock);
    const operationKey=`${kind==="caldav"?"calendar":"source"}:${kind}`;
    if(!lock||version===undefined||lock.userId!==this.scope.userId||lock.operationKey!==operationKey)throw new OperationOwnershipError("SYNC_RECOVERY_REQUIRED");
    // Join the common services' accepted-write batch, under the same captured
    // server owner/control version. A revoked owner cannot clear a candidate.
    return this.db.prepare(`DELETE FROM app_settings WHERE user_id=? AND key=? AND value=?
      AND EXISTS (SELECT 1 FROM operation_locks lock JOIN abuse_controls control ON control.control_key=?
        WHERE lock.user_id=? AND lock.operation_key=? AND lock.owner_nonce=? AND lock.state='running'
          AND control.enabled=1 AND control.version=?)`)
      .bind(this.scope.userId,keys[kind],expectedEnvelope,`provider:${kind}`,this.scope.userId,operationKey,lock.ownerNonce,version);
  }

  prepareFinishCleanup(completedValue:string):D1PreparedStatementLike{
    // A lost CAS cannot clear candidates belonging to still-active progress.
    return this.db.prepare(`DELETE FROM app_settings WHERE user_id=? AND key IN (${keyList})
      AND EXISTS (SELECT 1 FROM app_settings WHERE user_id=? AND key='onboarding' AND value=? AND json_extract(value,'$.status')='completed')`)
      .bind(this.scope.userId,this.scope.userId,completedValue);
  }
}
