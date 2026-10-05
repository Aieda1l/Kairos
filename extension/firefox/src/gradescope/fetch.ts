import {
  PROTOCOL_VERSION,
  gradescopeDiscoverResultV1Schema,
  gradescopeSyncResultV1Schema,
  type GradescopeCourseSyncResultV1,
  type GradescopeDiscoverRequestV1,
  type GradescopeDiscoverResultV1,
  type GradescopeDiagnosticCode,
  type GradescopeSyncErrorCode,
  type GradescopeSyncRequestV1,
  type GradescopeSyncResultV1,
} from "@/lib/extension-protocol/gradescope";
import { extractGradescopeStudentCourses } from "./extract-courses";
import { extractGradescopeStudentAssignments, GradescopeParseError } from "./extract-assignments";

const GRADESCOPE_ORIGIN="https://www.gradescope.com";
const CONCURRENCY=4;

function diagnosticForStatus(status:number):GradescopeDiagnosticCode {
  if(status===429)return "HTTP_429";
  if(status>=500&&status<=599)return "HTTP_5XX";
  return "HTTP_OTHER";
}

function classifyFinalUrl(finalUrl:string, expectedPath:string):"ok"|"signed_out"|"unexpected" {
  let parsed:URL;
  try{
    parsed=new URL(finalUrl,GRADESCOPE_ORIGIN);
  }catch{
    return "unexpected";
  }
  if(parsed.origin!==GRADESCOPE_ORIGIN)return "unexpected";
  if(/^\/login(?:\/|$)/i.test(parsed.pathname))return "signed_out";
  return parsed.pathname===expectedPath||parsed.pathname===`${expectedPath}/`?"ok":"unexpected";
}

function discoverFailure(
  requestId:string,
  errorCode:GradescopeSyncErrorCode,
  diagnosticCode?:GradescopeDiagnosticCode,
  httpStatus?:number,
):GradescopeDiscoverResultV1 {
  return gradescopeDiscoverResultV1Schema.parse({
    protocolVersion:PROTOCOL_VERSION,
    requestId,
    courses:[],
    errorCode,
    ...(diagnosticCode?{diagnosticCode}:{}),
    ...(httpStatus!==undefined?{httpStatus}:{}),
  });
}

export async function discoverGradescopeCourses(
  request:GradescopeDiscoverRequestV1,
  fetchImpl:typeof fetch=fetch,
):Promise<GradescopeDiscoverResultV1> {
  try{
    const response=await fetchImpl("/account",{credentials:"include",redirect:"follow"});
    if(response.status===401||response.status===403){
      return discoverFailure(request.requestId,"GRADESCOPE_SIGNED_OUT");
    }
    if(!response.ok){
      return discoverFailure(
        request.requestId,
        "GRADESCOPE_NETWORK_ERROR",
        diagnosticForStatus(response.status),
        response.status,
      );
    }

    const finalUrl=response.url||`${GRADESCOPE_ORIGIN}/account`;
    const kind=classifyFinalUrl(finalUrl,"/account");
    if(kind==="signed_out")return discoverFailure(request.requestId,"GRADESCOPE_SIGNED_OUT");
    if(kind==="unexpected")return discoverFailure(request.requestId,"GRADESCOPE_NETWORK_ERROR");

    const html=await response.text();
    try{
      const courses=extractGradescopeStudentCourses(html);
      return gradescopeDiscoverResultV1Schema.parse({
        protocolVersion:PROTOCOL_VERSION,
        requestId:request.requestId,
        courses,
        errorCode:null,
      });
    }catch(error){
      if(error instanceof GradescopeParseError){
        return discoverFailure(request.requestId,"GRADESCOPE_PARSE_ERROR");
      }
      throw error;
    }
  }catch{
    return discoverFailure(request.requestId,"GRADESCOPE_NETWORK_ERROR","FETCH_EXCEPTION");
  }
}

function courseFailure(
  courseId:string,
  checkedAt:string,
  errorCode:GradescopeSyncErrorCode,
  diagnosticCode?:GradescopeDiagnosticCode,
  httpStatus?:number,
):GradescopeCourseSyncResultV1 {
  return {
    courseId,
    checkedAt,
    assignments:[],
    errorCode,
    ...(diagnosticCode?{diagnosticCode}:{}),
    ...(httpStatus!==undefined?{httpStatus}:{}),
    parseDiagnosticCounts:[],
  };
}

function summarizeError(courses:GradescopeCourseSyncResultV1[]):GradescopeSyncErrorCode|null {
  const failed=courses.filter(course=>course.errorCode);
  if(failed.length===0)return null;
  if(failed.length<courses.length)return "PARTIAL_SYNC";
  const first=failed[0]?.errorCode??"GRADESCOPE_NETWORK_ERROR";
  return failed.every(course=>course.errorCode===first)?first:"GRADESCOPE_NETWORK_ERROR";
}

export async function fetchGradescopeAssignments(
  request:GradescopeSyncRequestV1,
  fetchImpl:typeof fetch=fetch,
  now:()=>Date=()=>new Date(),
):Promise<GradescopeSyncResultV1> {
  const results=new Array<GradescopeCourseSyncResultV1>(request.courseIds.length);
  let cursor=0;

  async function worker():Promise<void>{
    while(true){
      const index=cursor++;
      if(index>=request.courseIds.length)return;
      const courseId=request.courseIds[index];
      const checkedAt=now().toISOString();
      const path=`/courses/${courseId}`;

      try{
        const response=await fetchImpl(path,{credentials:"include",redirect:"follow"});
        if(response.status===401||response.status===403){
          results[index]=courseFailure(courseId,checkedAt,"GRADESCOPE_SIGNED_OUT");
          continue;
        }
        if(response.status===404){
          results[index]=courseFailure(courseId,checkedAt,"GRADESCOPE_COURSE_UNAVAILABLE");
          continue;
        }
        if(!response.ok){
          results[index]=courseFailure(
            courseId,
            checkedAt,
            "GRADESCOPE_NETWORK_ERROR",
            diagnosticForStatus(response.status),
            response.status,
          );
          continue;
        }

        const finalUrl=response.url||`${GRADESCOPE_ORIGIN}${path}`;
        const kind=classifyFinalUrl(finalUrl,path);
        if(kind==="signed_out"){
          results[index]=courseFailure(courseId,checkedAt,"GRADESCOPE_SIGNED_OUT");
          continue;
        }
        if(kind==="unexpected"){
          results[index]=courseFailure(courseId,checkedAt,"GRADESCOPE_NETWORK_ERROR");
          continue;
        }

        const html=await response.text();
        try{
          const parsed=extractGradescopeStudentAssignments(html,courseId,checkedAt);
          results[index]={
            courseId,
            checkedAt,
            assignments:parsed.assignments,
            errorCode:null,
            parseDiagnosticCounts:parsed.diagnostics,
          };
        }catch(error){
          if(error instanceof GradescopeParseError){
            results[index]=courseFailure(courseId,checkedAt,"GRADESCOPE_PARSE_ERROR");
            continue;
          }
          throw error;
        }
      }catch{
        results[index]=courseFailure(
          courseId,
          checkedAt,
          "GRADESCOPE_NETWORK_ERROR",
          "FETCH_EXCEPTION",
        );
      }
    }
  }

  await Promise.all(
    Array.from({length:Math.min(CONCURRENCY,request.courseIds.length)},()=>worker()),
  );

  return gradescopeSyncResultV1Schema.parse({
    protocolVersion:PROTOCOL_VERSION,
    requestId:request.requestId,
    courses:results,
    errorCode:summarizeError(results),
  });
}
