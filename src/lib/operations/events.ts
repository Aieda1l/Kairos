import "server-only";
import {claimOperationEvent,operationContextSnapshot,operationDataField,type OperationContext} from "./context";
export type {OperationAction,OperationContext} from "./context";

export const OPERATION_CODES=[
  "AUTH_SIGNED_IN","AUTH_SIGNED_OUT","AUTH_FAILED","AUTH_REJECTED","AUTH_REQUIRED",
  "CREDENTIAL_CONNECTED","CREDENTIAL_TESTED","CREDENTIAL_REJECTED",
  "SOURCE_SYNCED","CALENDAR_CONNECTED","CALENDAR_SYNCED",
  "UPSTREAM_HTTP_ERROR","UPSTREAM_TIMEOUT","UPSTREAM_TRANSPORT_ERROR",
  "CALENDAR_AUTH_REQUIRED","CALENDAR_AUTH_EXPIRED","CALENDAR_PERMISSION_DENIED",
  "CALENDAR_CONFIG_MISSING","CALENDAR_NETWORK_ERROR","CALENDAR_RATE_LIMITED",
  "CALENDAR_UPSTREAM_ERROR","CALENDAR_REMOTE_CALENDAR_MISSING","CALENDAR_EVENT_INVALID",
  "CALENDAR_PARTIAL_SYNC","CALDAV_DISCOVERY_FAILED","CALDAV_NOT_WRITABLE",
  "RATE_LIMITED","SERVICE_UNAVAILABLE","HEALTH_OK","HEALTH_FAILED",
] as const;
export type OperationCode=typeof OPERATION_CODES[number];
export type OperationOutcome={
  code:OperationCode;
  result:"ok"|"rejected"|"error";
  provider?:"google"|"microsoft"|"caldav"|"canvas"|"gradescope"|"ed";
  status?:number;
  durationMs?:number;
};
const codes:ReadonlySet<string>=new Set(OPERATION_CODES);
const providers:ReadonlySet<string>=new Set(["google","microsoft","caldav","canvas","gradescope","ed"]);

/** One terminal JSON record per scope (or standalone call); input objects never reach the sink. */
export function emitOperationEvent(context:OperationContext,outcome:OperationOutcome):void{
  const safeContext=operationContextSnapshot(context);
  const code=operationDataField(outcome,"code");
  const result=operationDataField(outcome,"result");
  if(!safeContext||typeof code!=="string"||!codes.has(code)
    ||(result!=="ok"&&result!=="rejected"&&result!=="error"))return;
  if(!claimOperationEvent(safeContext))return;
  const provider=operationDataField(outcome,"provider");
  const status=operationDataField(outcome,"status");
  const durationMs=operationDataField(outcome,"durationMs");
  const event={
    event:"kairos.operation",schemaVersion:1,...safeContext,code,result,
    ...(typeof provider==="string"&&providers.has(provider)?{provider}:{}),
    ...(typeof status==="number"&&Number.isInteger(status)&&status>=100&&status<=599?{status}:{}),
    ...(typeof durationMs==="number"&&Number.isFinite(durationMs)&&durationMs>=0&&durationMs<=86_400_000
      ?{durationMs:Math.floor(durationMs)}:{}),
  };
  // Logging must not turn a completed operation into an exception.
  try{
    const serialized=JSON.stringify(event);
    if(result==="ok")console.info(serialized);
    else console.warn(serialized);
  }catch{}
}
