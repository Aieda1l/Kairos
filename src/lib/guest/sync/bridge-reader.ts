import {ExtensionBridgeError,pingKairosExtension,syncExtensionBatch} from "@/features/submission-status/extension-bridge";
import {GradescopeBridgeError,discoverGradescopeExtension,syncGradescopeExtensionBatch} from "@/features/gradescope/extension-bridge";
import {GuestDataError} from "../errors";

export interface GuestBridgeReader {
  ping:typeof pingKairosExtension;
  canvas:typeof syncExtensionBatch;
  gradescopeDiscover:typeof discoverGradescopeExtension;
  gradescopeSync:typeof syncGradescopeExtensionBatch;
}
async function safe<T>(read:()=>Promise<T>):Promise<T> {
  try{return await read();}
  catch(error){
    throw new GuestDataError(error instanceof ExtensionBridgeError || error instanceof GradescopeBridgeError?error.code:"INVALID_RESULT");
  }
}
/** Callers supply fresh, registered request IDs. Adapters never consume registrations. */
export function createGuestBridgeReader():GuestBridgeReader {
  return {
    ping:(timeoutMs)=>safe(()=>pingKairosExtension(timeoutMs)),
    canvas:(input,timeoutMs)=>safe(()=>syncExtensionBatch(input,timeoutMs)),
    gradescopeDiscover:(input,timeoutMs)=>safe(()=>discoverGradescopeExtension(input,timeoutMs)),
    gradescopeSync:(input,timeoutMs)=>safe(()=>syncGradescopeExtensionBatch(input,timeoutMs)),
  };
}
