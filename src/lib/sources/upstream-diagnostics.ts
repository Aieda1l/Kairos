// Keep Worker diagnostics limited to known constants and numeric HTTP statuses.
// Never log request URLs, response bodies, thrown errors, or credentials: Canvas
// feed URLs and Ed fetch errors may contain private tokens.
export function reportSourceRequestFailure(
  provider:"canvas"|"ed",
  reason:"http"|"timeout"|"transport",
  status?:number,
):void{
  console.warn("Kairos source request failed",{
    provider,
    reason,
    ...(reason==="http"&&status!==undefined?{status}:{}),
  });
}
