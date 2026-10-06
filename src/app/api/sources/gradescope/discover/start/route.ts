import {startGradescopeDiscovery} from "@/lib/gradescope/discovery-service";
import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";

export async function POST(){
  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;
  const result=runtime.kind==="legacy"
    ?startGradescopeDiscovery(runtime.db)
    :await startGradescopeDiscovery(runtime.db,runtime.scope);
  return Response.json(result);
}
