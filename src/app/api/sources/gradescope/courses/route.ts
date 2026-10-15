import {z} from "zod";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCourseRepository} from "@/lib/db/d1/repositories/source-courses";
import {SourceConnectionRepository} from "@/lib/db/repositories/source-connections";
import {SourceCourseRepository} from "@/lib/db/repositories/source-courses";
import {
  replaceEnabledGradescopeCourses,
  GradescopeDiscoveryServiceError,
} from "@/lib/gradescope/discovery-service";
import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";

const selectionSchema=z.object({
  enabledCourseIds:z.array(z.string().regex(/^\d+$/)).max(50).refine(
    values=>new Set(values).size===values.length,
    "Course identifiers must be unique.",
  ),
}).strict();

export async function GET(){
  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;

  if(runtime.kind==="legacy"){
    const connection=new SourceConnectionRepository(runtime.db)
      .getByKind("gradescope");
    if(!connection)return Response.json({connection:null,courses:[]});
    return Response.json({
      connection,
      courses:new SourceCourseRepository(runtime.db).list(connection.id),
    });
  }

  const connection=await new D1SourceConnectionRepository(runtime.db,runtime.scope)
    .getByKind("gradescope");
  if(!connection)return Response.json({connection:null,courses:[]});
  return Response.json({
    connection,
    courses:await new D1SourceCourseRepository(runtime.db,runtime.scope)
      .list(connection.id),
  });
}

export async function PUT(request:Request){
  let body:unknown;
  try{body=await request.json();}
  catch{
    return Response.json(
      {code:"INVALID_COURSE_SELECTION",message:"Choose valid Gradescope courses."},
      {status:400},
    );
  }
  const parsed=selectionSchema.safeParse(body);
  if(!parsed.success){
    return Response.json(
      {code:"INVALID_COURSE_SELECTION",message:"Choose valid Gradescope courses."},
      {status:400},
    );
  }

  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;

  try{
    const result=runtime.kind==="legacy"
      ?replaceEnabledGradescopeCourses(runtime.db,parsed.data.enabledCourseIds)
      :await replaceEnabledGradescopeCourses(
        runtime.db,runtime.scope,parsed.data.enabledCourseIds,
      );
    return Response.json(result);
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
