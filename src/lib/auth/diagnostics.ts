import {createOperationContext,getOperationContext,operationDataField} from "@/lib/operations/context";
import {emitOperationEvent} from "@/lib/operations/events";

export const authDiagnostics={
  // The global logger reads request-local context; never retain Auth.js objects.
  error(_error:Error):void{
    void _error;
    emitOperationEvent(getOperationContext()??createOperationContext("auth.callback"),{
      code:"AUTH_FAILED",result:"error",
    });
  },
  debug(message:string,metadata?:unknown):void{
    // Auth.js also sends access tokens and full user profiles to debug().
    // Ignore every event except the rejected OAuth authorization response.
    if(message!=="OAuthCallbackError")return;
    const providerId=operationDataField(metadata,"providerId");
    emitOperationEvent(getOperationContext()??createOperationContext("auth.callback"),{
      code:"AUTH_REJECTED",result:"rejected",
      ...(providerId==="microsoft-entra-id"?{provider:"microsoft" as const}
        :providerId==="google"?{provider:"google" as const}:{}),
    });
  },
};
