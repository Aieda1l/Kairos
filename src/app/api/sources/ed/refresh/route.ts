import { getDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { EdDiscoveryServiceError, refreshEdCourses } from "@/lib/ed/discovery-service";
import { EdSourceError } from "@/lib/sources/ed/errors";
import { getEdRouteFetch } from "@/lib/ed/e2e-fixture-fetch";

export async function POST(){
  const db=getDatabase();
  migrate(db);
  try{
    return Response.json(await refreshEdCourses(db,getEdRouteFetch()));
  }catch(error){
    if(error instanceof EdDiscoveryServiceError){
      return Response.json({code:error.code,message:error.message},{status:409});
    }
    if(error instanceof EdSourceError){
      return Response.json({code:error.code,message:error.message},{status:error.code==="ED_AUTH_INVALID"?401:502});
    }
    return Response.json({code:"ED_UPSTREAM_ERROR",message:"Ed courses could not be refreshed."},{status:502});
  }
}
