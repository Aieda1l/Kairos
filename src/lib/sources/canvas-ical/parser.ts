import "server-only";
import crypto from "node:crypto";
import {parseCanvasCore} from "./parser-core";
export {splitCanvasEvents} from "./parser-core";
export function parseCanvasIcal(input:string) {
 const {fallbacks,...report}=parseCanvasCore(input);
 const assignments:typeof report.assignments=[];
 let skipped=report.skipped;const errors=[...report.errors];
 for(const [index,row] of report.assignments.entries()){
  try{
   const fields=fallbacks.get(index);
   assignments.push(fields?{...row,externalId:`fallback-${crypto.createHash("sha256").update(fields.join("\u001f")).digest("hex")}`}:row);
  }catch{skipped++;errors.push("Skipped one malformed Canvas assignment event.");}
 }
 return {assignments,skipped,errors};
}
