import { z } from "zod";
import { getDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";
import {
  replaceEnabledGradescopeCourses,
  GradescopeDiscoveryServiceError,
} from "@/lib/gradescope/discovery-service";

const selectionSchema=z.object({
  enabledCourseIds:z.array(z.string().regex(/^\d+$/)).max(50).refine(
    values=>new Set(values).size===values.length,
    "Course identifiers must be unique.",
  ),
}).strict();

export async function GET(){
  const db=getDatabase();
  migrate(db);
  const connection=new SourceConnectionRepository(db).getByKind("gradescope");
  if(!connection)return Response.json({connection:null,courses:[]});
  return Response.json({
    connection,
    courses:new SourceCourseRepository(db).list(connection.id),
  });
}

export async function PUT(request:Request){
  let body:unknown;
  try{
    body=await request.json();
  }catch{
    return Response.json({code:"INVALID_COURSE_SELECTION",message:"Choose valid Gradescope courses."},{status:400});
  }
  const parsed=selectionSchema.safeParse(body);
  if(!parsed.success){
    return Response.json({code:"INVALID_COURSE_SELECTION",message:"Choose valid Gradescope courses."},{status:400});
  }

  const db=getDatabase();
  migrate(db);
  try{
    return Response.json(replaceEnabledGradescopeCourses(db,parsed.data.enabledCourseIds));
  }catch(error){
    if(error instanceof GradescopeDiscoveryServiceError){
      return Response.json(
        {code:error.code,message:error.message},
        {status:error.code==="GRADESCOPE_NOT_CONFIGURED"?409:400},
      );
    }
    return Response.json(
      {code:"GRADESCOPE_SELECTION_FAILED",message:"Gradescope course selection could not be saved."},
      {status:500},
    );
  }
}
