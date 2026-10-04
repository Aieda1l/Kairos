import type {
  AssignmentSubmissionStatus,
  SubmissionSyncErrorCode,
} from "@/lib/submission-status/types";

export const CANVAS_EXTRACTOR_VERSION="canvas-html-v1";

export type ExtractedCanvasSubmissionStatus=AssignmentSubmissionStatus&{
  errorCode?:SubmissionSyncErrorCode;
};

function unavailable(
  checkedAt:string,
  errorCode?:SubmissionSyncErrorCode,
):ExtractedCanvasSubmissionStatus {
  return {
    state:"unknown",
    isLate:false,
    isMissing:false,
    submittedAt:null,
    checkedAt,
    extractorVersion:CANVAS_EXTRACTOR_VERSION,
    ...(errorCode?{errorCode}:{}),
  };
}

export function extractCanvasSubmissionStatus(
  html:string,
  finalUrl:string,
  checkedAt:string,
):ExtractedCanvasSubmissionStatus {
  const document=new DOMParser().parseFromString(html,"text/html");
  let url:URL|null=null;
  try{url=new URL(finalUrl);}catch{}

  if(
    !url ||
    url.hostname!=="canvas.uw.edu" ||
    /\/login(?:\/|$)/i.test(url.pathname) ||
    Boolean(document.querySelector("#login_form, form[action*='login']"))
  ){
    return unavailable(checkedAt,"CANVAS_SIGNED_OUT");
  }

  const sidebar=document.querySelector("#sidebar_content");
  const submission=document.querySelector(".submission_details");
  const scopeText=[sidebar?.textContent??"",submission?.textContent??""].join(" ").replace(/\s+/g," ").trim();
  const hasNotSubmitted=/\bNot\s+Submitted!?/i.test(scopeText);
  const withoutNotSubmitted=scopeText.replace(/\bNot\s+Submitted!?/gi," ");
  const hasSubmitted=/\bSubmitted!?/i.test(withoutNotSubmitted);
  if(hasSubmitted&&hasNotSubmitted){
    return unavailable(checkedAt,"UNRECOGNIZED_STATUS");
  }

  const enteredGrade=(document.querySelector(".submission_details .entered_grade")?.textContent??"").trim();
  const excused=/^Excused$/i.test(enteredGrade);
  const graded=Boolean(enteredGrade)&&!excused;
  const state=excused
    ?"excused"
    :graded
      ?"graded"
      :hasSubmitted
        ?"submitted"
        :hasNotSubmitted
          ?"not_submitted"
          :"unknown";

  const isLate=Boolean(document.querySelector(".late_status, .late, [data-status='late']"))||/\bLate\b/i.test(scopeText);
  const isMissing=Boolean(document.querySelector(".missing_status, .missing, [data-status='missing']"))||/\bMissing\b/i.test(scopeText);
  const submittedElement=document.querySelector("[data-submitted-at], #sidebar_content time[datetime]");
  const submittedValue=submittedElement?.getAttribute("data-submitted-at")??submittedElement?.getAttribute("datetime")??null;
  const submittedAt=submittedValue&&Number.isFinite(Date.parse(submittedValue))
    ?new Date(submittedValue).toISOString()
    :null;

  return {
    state,
    isLate,
    isMissing,
    submittedAt,
    checkedAt,
    extractorVersion:CANVAS_EXTRACTOR_VERSION,
  };
}
