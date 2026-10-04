import {
  PROTOCOL_VERSION,
  type CanvasBatchResultV1,
  type SubmissionFailureDiagnostic,
  type SubmissionStatusResultV1,
  type SubmissionSyncRequestV1,
} from "@/lib/extension-protocol/submission-status";
import type { CanvasAssignmentLocator, SubmissionSyncErrorCode } from "@/lib/submission-status/types";
import { CANVAS_EXTRACTOR_VERSION, extractCanvasSubmissionStatus } from "./extract-status";

const CONCURRENCY=4;

function classifyFinalCanvasUrl(
  finalUrl:string,
  assignment:CanvasAssignmentLocator,
):"assignment"|"signed_out"|"unexpected" {
  let parsed:URL;
  try{
    parsed=new URL(finalUrl);
  }catch{
    return "unexpected";
  }

  if(parsed.origin!=="https://canvas.uw.edu"||/\/login(?:\/|$)/i.test(parsed.pathname)){
    return "signed_out";
  }

  const match=parsed.pathname.match(/^\/courses\/(\d+)\/assignments\/(\d+)\/?$/);
  if(!match||match[1]!==assignment.courseId||match[2]!==assignment.assignmentId){
    return "unexpected";
  }
  return "assignment";
}

function errorResult(
  assignment:CanvasAssignmentLocator,
  checkedAt:string,
  errorCode:SubmissionSyncErrorCode,
  diagnosticCode?:SubmissionFailureDiagnostic,
  httpStatus?:number,
):SubmissionStatusResultV1 {
  return {
    ...assignment,
    state:"unknown",
    isLate:false,
    isMissing:false,
    submittedAt:null,
    checkedAt,
    extractorVersion:CANVAS_EXTRACTOR_VERSION,
    errorCode,
    ...(diagnosticCode?{diagnosticCode}:{}),
    ...(httpStatus!==undefined?{httpStatus}:{}),
  };
}

function diagnosticForStatus(status:number):SubmissionFailureDiagnostic {
  if(status===429)return "HTTP_429";
  if(status>=500&&status<=599)return "HTTP_5XX";
  return "HTTP_OTHER";
}

function summarizeError(results:SubmissionStatusResultV1[]):SubmissionSyncErrorCode|null {
  const failed=results.filter(result=>result.errorCode);
  if(failed.length===0)return null;
  if(failed.length<results.length)return "PARTIAL_SYNC";
  if(failed.every(result=>result.errorCode==="CANVAS_SIGNED_OUT"))return "CANVAS_SIGNED_OUT";
  return failed[0].errorCode??"CANVAS_NETWORK_ERROR";
}

export async function fetchCanvasSubmissionStatuses(
  request:SubmissionSyncRequestV1,
  fetchImpl:typeof fetch=fetch,
  now:()=>Date=()=>new Date(),
):Promise<CanvasBatchResultV1> {
  const results=new Array<SubmissionStatusResultV1>(request.assignments.length);
  let cursor=0;

  async function worker():Promise<void>{
    while(true){
      const index=cursor++;
      if(index>=request.assignments.length)return;
      const assignment=request.assignments[index];
      const checkedAt=now().toISOString();
      const path=`/courses/${assignment.courseId}/assignments/${assignment.assignmentId}`;
      try{
        const response=await fetchImpl(path,{credentials:"include",redirect:"follow"});
        if(response.status===401||response.status===403){
          results[index]=errorResult(assignment,checkedAt,"CANVAS_SIGNED_OUT");
          continue;
        }
        if(!response.ok){
          results[index]=errorResult(
            assignment,
            checkedAt,
            response.status===404?"UNRECOGNIZED_STATUS":"CANVAS_NETWORK_ERROR",
            response.status===404?undefined:diagnosticForStatus(response.status),
            response.status,
          );
          continue;
        }
        const finalUrl=response.url||`https://canvas.uw.edu${path}`;
        const finalUrlKind=classifyFinalCanvasUrl(finalUrl,assignment);
        if(finalUrlKind==="signed_out"){
          results[index]=errorResult(assignment,checkedAt,"CANVAS_SIGNED_OUT");
          continue;
        }
        if(finalUrlKind==="unexpected"){
          results[index]=errorResult(assignment,checkedAt,"UNRECOGNIZED_STATUS");
          continue;
        }

        const html=await response.text();
        const extracted=extractCanvasSubmissionStatus(html,finalUrl,checkedAt);
        results[index]={
          ...assignment,
          state:extracted.state,
          isLate:extracted.isLate,
          isMissing:extracted.isMissing,
          submittedAt:extracted.submittedAt,
          checkedAt:extracted.checkedAt,
          extractorVersion:extracted.extractorVersion,
          ...(extracted.errorCode?{errorCode:extracted.errorCode}:{}),
        };
      }catch{
        results[index]=errorResult(assignment,checkedAt,"CANVAS_NETWORK_ERROR","FETCH_EXCEPTION");
      }
    }
  }

  const workers=Array.from({length:Math.min(CONCURRENCY,request.assignments.length)},()=>worker());
  await Promise.all(workers);
  return {
    protocolVersion:PROTOCOL_VERSION,
    requestId:request.requestId,
    results,
    errorCode:summarizeError(results),
  };
}
