import { getDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import {
  completeGradescopeSync,
  gradescopeSyncCompleteInputSchema,
  GradescopeSyncServiceError,
} from "@/lib/gradescope/sync-service";

export async function POST(request:Request){
  let body:unknown;
  try{
    body=await request.json();
  }catch{
    return Response.json({code:"INVALID_RESULT",message:"The Gradescope sync result was invalid."},{status:400});
  }
  const parsed=gradescopeSyncCompleteInputSchema.safeParse(body);
  if(!parsed.success){
    return Response.json({code:"INVALID_RESULT",message:"The Gradescope sync result was invalid."},{status:400});
  }

  const db=getDatabase();
  migrate(db);
  try{
    return Response.json(completeGradescopeSync(db,parsed.data));
  }catch(error){
    if(error instanceof GradescopeSyncServiceError){
      return Response.json(
        {code:error.code,message:error.message},
        {status:error.code==="SYNC_REQUEST_NOT_FOUND"?409:400},
      );
    }
    return Response.json(
      {code:"GRADESCOPE_SYNC_FAILED",message:"Gradescope sync could not be saved."},
      {status:500},
    );
  }
}
