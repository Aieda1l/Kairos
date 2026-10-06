import "server-only";
import {createHash} from "node:crypto";
import type {Assignment} from "@/lib/assignments/types";

export type CalendarEventProjection={
  assignmentId:string;
  title:string;
  description:string;
  startsAt:string;
  endsAt:string;
  sourceUrl:string|null;
};

function cleanText(value:string):string{
  return value.replace(/[\u0000-\u001f\u007f]+/g," ").replace(/\s+/g," ").trim();
}

function sourceName(source:Assignment["source"]):string{
  switch(source){
    case "canvas":return "Canvas";
    case "gradescope":return "Gradescope";
    case "ed":return "Ed";
  }
}

function statusText(assignment:Assignment):string{
  if(assignment.sourceStatusText?.trim())return cleanText(assignment.sourceStatusText);
  const state=assignment.submissionStatus?.state;
  if(state){
    switch(state){
      case "not_submitted":return "Not submitted";
      case "submitted":return "Submitted";
      case "graded":return "Graded";
      case "excused":return "Excused";
      case "unknown":return "Status unavailable";
    }
  }
  switch(assignment.status){
    case "pending":return "Pending";
    case "submitted":return "Submitted";
    case "graded":return "Graded";
    case "overdue":return "Overdue";
    case "unknown":return "Status unavailable";
  }
}

function safeSourceUrl(raw:string|null):string|null{
  if(!raw)return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:"&&url.protocol!=="http:")return null;
    url.username="";
    url.password="";
    url.search="";
    url.hash="";
    return url.toString().replace(/\/$/,"");
  }catch{
    return null;
  }
}

type CalendarProjectionOptions={
  hideSubmitted?:boolean;
};

function isCalendarComplete(assignment:Assignment):boolean{
  const submission=assignment.submissionStatus?.state;
  if(submission==="submitted"||submission==="graded"||submission==="excused")return true;
  if(submission==="not_submitted")return false;
  return assignment.status==="submitted"||assignment.status==="graded";
}

export function projectAssignment(
  assignment:Assignment,
  options:CalendarProjectionOptions={},
):CalendarEventProjection|null{
  if(options.hideSubmitted&&isCalendarComplete(assignment))return null;
  if(!assignment.dueAt)return null;
  const due=new Date(assignment.dueAt);
  if(!Number.isFinite(due.getTime()))return null;
  const startsAt=due.toISOString();
  const endsAt=new Date(due.getTime()+15*60*1000).toISOString();
  const course=cleanText(assignment.courseName)||"Course";
  const title=`[${course}] ${cleanText(assignment.title)}`;
  const sourceUrl=safeSourceUrl(assignment.sourceUrl);
  const lines=[
    `Course: ${course}`,
    `Source: ${sourceName(assignment.source)}`,
    `Status: ${statusText(assignment)}`,
    `Due: ${startsAt}`,
  ];
  if(sourceUrl)lines.push("","Open in source:",sourceUrl);
  return {
    assignmentId:assignment.id,
    title,
    description:lines.join("\n"),
    startsAt,
    endsAt,
    sourceUrl,
  };
}

export function hashCalendarProjection(projection:CalendarEventProjection):string{
  const serialized=JSON.stringify({
    assignmentId:projection.assignmentId,
    title:projection.title,
    description:projection.description,
    startsAt:projection.startsAt,
    endsAt:projection.endsAt,
    sourceUrl:projection.sourceUrl,
  });
  return createHash("sha256").update(serialized).digest("hex");
}
