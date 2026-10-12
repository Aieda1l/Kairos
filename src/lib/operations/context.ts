import "server-only";
import {AsyncLocalStorage} from "node:async_hooks";

export const OPERATION_ACTIONS=[
  "auth.sign_in","auth.callback","auth.sign_out","credential.connect","credential.test",
  "source.sync","calendar.connect","calendar.sync","health.check",
] as const;
export type OperationAction=typeof OPERATION_ACTIONS[number];
export type OperationContext=Readonly<{requestId:string;action:OperationAction;releaseId:string}>;

const actions:ReadonlySet<string>=new Set(OPERATION_ACTIONS);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const release=/^(?:[0-9a-f]{7,40}|v?[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6})$/;
type ContextState={context:OperationContext;terminalEventEmitted:boolean};
const storage=new AsyncLocalStorage<ContextState>();

// Read data properties only. Never invoke getters, toJSON, or traverse metadata.
export function operationDataField(value:unknown,key:string):unknown{
  if(value===null||typeof value!=="object")return undefined;
  try{return Object.getOwnPropertyDescriptor(value,key)?.value;}catch{return undefined;}
}

export function createOperationContext(action:OperationAction,releaseId?:string):OperationContext{
  if(typeof action!=="string"||!actions.has(action))throw new Error("Invalid operation action");
  const candidate=releaseId??process.env.KAIROS_RELEASE_ID;
  return Object.freeze({
    requestId:crypto.randomUUID(),action,
    releaseId:typeof candidate==="string"&&candidate.length<=40&&release.test(candidate)?candidate:"unknown",
  });
}

/** Internal validation shared by the context boundary and event serializer. */
export function operationContextSnapshot(value:unknown):OperationContext|null{
  const requestId=operationDataField(value,"requestId");
  const action=operationDataField(value,"action");
  const releaseId=operationDataField(value,"releaseId");
  if(typeof requestId!=="string"||requestId.length!==36||!uuid.test(requestId)
    ||typeof action!=="string"||!actions.has(action)
    ||typeof releaseId!=="string"||releaseId.length>40
    ||(releaseId!=="unknown"&&!release.test(releaseId)))return null;
  return Object.freeze({requestId,action:action as OperationAction,releaseId});
}

export async function runWithOperationContext<T>(context:OperationContext,work:()=>Promise<T>):Promise<T>{
  const snapshot=operationContextSnapshot(context);
  if(!snapshot)throw new Error("Invalid operation context");
  const parent=storage.getStore();
  // Nested runtime resolvers preserve the terminal-outcome slot of their owner.
  const state=parent&&parent.context.requestId===snapshot.requestId
    &&parent.context.action===snapshot.action&&parent.context.releaseId===snapshot.releaseId
    ?parent:{context:snapshot,terminalEventEmitted:false};
  return storage.run(state,work);
}

export function getOperationContext():OperationContext|null{
  return storage.getStore()?.context??null;
}

/** Internal: suppress duplicate terminal emissions inside the same scoped work. */
export function claimOperationEvent(context:OperationContext):boolean{
  const state=storage.getStore();
  if(!state||state.context.requestId!==context.requestId
    ||state.context.action!==context.action||state.context.releaseId!==context.releaseId)return true;
  if(state.terminalEventEmitted)return false;
  state.terminalEventEmitted=true;
  return true;
}
