import {z} from "zod";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCourseRepository} from "@/lib/db/d1/repositories/source-courses";
import {SourceConnectionRepository} from "@/lib/db/repositories/source-connections";
import {SourceCourseRepository} from "@/lib/db/repositories/source-courses";
import {
  EdDiscoveryServiceError,
  replaceEnabledEdCourses,
} from "@/lib/ed/discovery-service";
import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";

const selectionSchema=z.object({
  enabledCourseIds:z.array(z.string().regex(/^\d+$/)).max(100).refine(
    values=>new Set(values).size===values.length,
    "Course identifiers must be unique.",
  ),
}).strict();

export async function GET(){
  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;

  if(runtime.kind==="legacy"){
    const connection=new SourceConnectionRepository(runtime.db).getByKind("ed");
    if(!connection)return Response.json({connection:null,courses:[]});
    return Response.json({
      connection,
      courses:new SourceCourseRepository(runtime.db).list(connection.id),
    });
  }

  const connection=await new D1SourceConnectionRepository(runtime.db,runtime.scope)
    .getByKind("ed");
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
      {code:"INVALID_COURSE_SELECTION",message:"Choose valid Ed courses."},
      {status:400},
    );
  }
  const parsed=selectionSchema.safeParse(body);
  if(!parsed.success){
    return Response.json(
      {code:"INVALID_COURSE_SELECTION",message:"Choose valid Ed courses."},
      {status:400},
    );
  }

  const resolved=await resolveSourceApiRuntime();
  if(!resolved.ok)return resolved.response;
  const runtime=resolved.runtime;

  try{
    const result=runtime.kind==="legacy"
      ?replaceEnabledEdCourses(runtime.db,parsed.data.enabledCourseIds)
      :await replaceEnabledEdCourses(
        runtime.db,runtime.scope,runtime.keyring,parsed.data.enabledCourseIds,
      );
    return Response.json(result);
  }catch(error){
    if(error instanceof EdDiscoveryServiceError){
      return Response.json(
        {code:error.code,message:error.message},
        {status:error.code==="ED_NOT_CONNECTED"?409:400},
      );
    }
    return Response.json(
      {code:"ED_UPSTREAM_ERROR",message:"Ed course selection could not be saved."},
      {status:500},
    );
  }
}
