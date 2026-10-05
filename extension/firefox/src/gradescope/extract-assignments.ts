import type {
  GradescopeAssignmentStructureDiagnosticsV1,
  GradescopeAssignmentV1,
} from "@/lib/extension-protocol/gradescope";
import { GradescopeParseError } from "./errors";

export { GradescopeParseError } from "./errors";

export const GRADESCOPE_EXTRACTOR_VERSION="gradescope-html-v1";

export type GradescopeParseDiagnostic={
  code:"UNRECOGNIZED_ROW"|"MISSING_STABLE_ID";
  count:number;
};

function normalizeText(value:string|null|undefined):string{
  return (value??"").replace(/\s+/g," ").trim();
}

function isoDate(value:string|null):string|null{
  if(!value)return null;
  const timestamp=Date.parse(value);
  return Number.isFinite(timestamp)?new Date(timestamp).toISOString():null;
}

function directCells(row:Element):Element[]{
  return Array.from(row.children).filter(child=>child.tagName==="TH"||child.tagName==="TD");
}

function findAssignmentTable(document:Document,courseId:string):Element|null{
  const tables=Array.from(document.querySelectorAll("table"));
  return tables.find(table=>{
    if(table.querySelector(
      `a[href^="/courses/${courseId}/assignments/"], button.js-submitAssignment[data-assignment-id]`,
    ))return true;
    const header=normalizeText(
      Array.from(table.querySelectorAll("thead th")).map(cell=>cell.textContent??"").join(" "),
    );
    return /\bassignment\b/i.test(header)&&/\b(status|points|grade)\b/i.test(header);
  })??null;
}


export function inspectGradescopeAssignmentStructure(
  html:string,
  courseId:string,
):GradescopeAssignmentStructureDiagnosticsV1{
  const document=new DOMParser().parseFromString(html,"text/html");
  return {
    courseRootDetected:Boolean(document.querySelector("main#course-show")),
    tableCount:document.querySelectorAll("table").length,
    roleRowCount:document.querySelectorAll('tr[role="row"]').length,
    assignmentLinkCount:document.querySelectorAll(
      `a[href^="/courses/${courseId}/assignments/"]`,
    ).length,
    submitButtonCount:document.querySelectorAll(
      "button.js-submitAssignment[data-assignment-id]",
    ).length,
    assignmentTableDetected:Boolean(findAssignmentTable(document,courseId)),
  };
}

function assignmentIdFromCell(cell:Element,courseId:string):string|null{
  const anchor=cell.querySelector("a[href]");
  if(anchor){
    const href=anchor.getAttribute("href")??"";
    const match=href.match(/^\/courses\/(\d+)\/assignments\/(\d+)(?:[/?#]|$)/);
    if(match&&match[1]===courseId)return match[2];
  }
  const button=cell.querySelector("button.js-submitAssignment[data-assignment-id]");
  const buttonId=button?.getAttribute("data-assignment-id")??"";
  return /^\d+$/.test(buttonId)?buttonId:null;
}

function titleFromCell(cell:Element):string{
  const primary=cell.querySelector("a[href],button.js-submitAssignment");
  return normalizeText(primary?.textContent??cell.textContent);
}

function statusAndGrade(sourceStatusText:string|null):{
  state:GradescopeAssignmentV1["state"];
  gradeScore:string|null;
  gradeMax:string|null;
  gradeDisplay:string|null;
}{
  if(sourceStatusText){
    const grade=sourceStatusText.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if(grade){
      return {
        state:"graded",
        gradeScore:grade[1],
        gradeMax:grade[2],
        gradeDisplay:`${grade[1]} / ${grade[2]}`,
      };
    }
    if(sourceStatusText==="Submitted"){
      return {state:"submitted",gradeScore:null,gradeMax:null,gradeDisplay:null};
    }
    if(sourceStatusText==="No Submission"||sourceStatusText==="Not Submitted"){
      return {state:"not_submitted",gradeScore:null,gradeMax:null,gradeDisplay:null};
    }
  }
  return {state:"unknown",gradeScore:null,gradeMax:null,gradeDisplay:null};
}

export function extractGradescopeStudentAssignments(
  html:string,
  courseId:string,
  checkedAt:string,
):{assignments:GradescopeAssignmentV1[];diagnostics:GradescopeParseDiagnostic[]}{
  const document=new DOMParser().parseFromString(html,"text/html");
  const table=findAssignmentTable(document,courseId);
  if(!table)throw new GradescopeParseError("Gradescope course page structure was not recognized.");

  const assignments:GradescopeAssignmentV1[]=[];
  let missingStableId=0;

  for(const row of Array.from(table.querySelectorAll('tr[role="row"]'))){
    if(row.closest("thead")||row.classList.contains("table--row-assignmentSection"))continue;
    const cells=directCells(row);
    if(cells.length<2)continue;

    const titleCell=cells[0];
    const statusCell=cells[1];
    const dateCell=cells[2]??row;
    const title=titleFromCell(titleCell);
    if(!title)continue;

    const assignmentId=assignmentIdFromCell(titleCell,courseId);
    if(!assignmentId){
      missingStableId++;
      continue;
    }

    const sourceStatus=normalizeText(statusCell.textContent);
    const sourceStatusText=sourceStatus||null;
    const parsed=statusAndGrade(sourceStatusText);
    const release=dateCell.querySelector(".submissionTimeChart--releaseDate")?.getAttribute("datetime")??null;
    const dueDates=Array.from(dateCell.querySelectorAll(".submissionTimeChart--dueDate"));

    assignments.push({
      courseId,
      assignmentId,
      title,
      releaseAt:isoDate(release),
      dueAt:isoDate(dueDates[0]?.getAttribute("datetime")??null),
      lateDueAt:isoDate(dueDates[1]?.getAttribute("datetime")??null),
      sourceStatusText,
      state:parsed.state,
      isLate:false,
      isMissing:false,
      submittedAt:null,
      gradeScore:parsed.gradeScore,
      gradeMax:parsed.gradeMax,
      gradeDisplay:parsed.gradeDisplay,
      checkedAt,
      extractorVersion:GRADESCOPE_EXTRACTOR_VERSION,
    });
  }

  const diagnostics:GradescopeParseDiagnostic[]=[];
  if(missingStableId>0)diagnostics.push({code:"MISSING_STABLE_ID",count:missingStableId});
  return {assignments,diagnostics};
}
