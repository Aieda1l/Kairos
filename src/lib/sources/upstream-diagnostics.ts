import {createOperationContext,getOperationContext} from "@/lib/operations/context";
import {emitOperationEvent} from "@/lib/operations/events";

// Keep Worker diagnostics limited to known constants and numeric HTTP statuses.
// Never log request URLs, response bodies, thrown errors, or credentials: Canvas
// feed URLs and Ed fetch errors may contain private tokens.
export function reportSourceRequestFailure(
  provider:"canvas"|"ed",
  reason:"http"|"timeout"|"transport",
  status?:number,
):void{
  // Contextual wrappers own terminal outcomes, including retries.
  if(getOperationContext()||(provider!=="canvas"&&provider!=="ed"))return;
  const code=reason==="http"?"UPSTREAM_HTTP_ERROR":reason==="timeout"?"UPSTREAM_TIMEOUT"
    :reason==="transport"?"UPSTREAM_TRANSPORT_ERROR":null;
  if(!code)return;
  emitOperationEvent(createOperationContext("source.sync"),{
    code,result:"error",provider,...(reason==="http"?{status}:{}),
  });
}
