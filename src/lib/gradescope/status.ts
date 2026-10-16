import type {Assignment} from '@/lib/assignments/types';
import type {GradescopeAssignmentV1} from '@/lib/extension-protocol/gradescope';

type Status=Pick<GradescopeAssignmentV1,'state'|'isLate'|'gradeScore'|'gradeMax'|'gradeDisplay'>;
const unknown:Status={state:'unknown',isLate:false,gradeScore:null,gradeMax:null,gradeDisplay:null};
const duration=String.raw`\d+\s+(?:Days?|Hours?|Minutes?|Seconds?)(?:\s*,?\s*\d+\s+(?:Days?|Hours?|Minutes?|Seconds?))*`;
const decorated=new RegExp(String.raw`^(Submitted|\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?)\s*(${duration}\s+Late)$`,'i');

/** Older bridge versions join adjacent status/late text nodes without a space. */
export function parseGradescopeStatus(value:string|null):Status{
  if(!value||value.length>2048)return {...unknown};
  const text=value.replace(/\s+/g,' ').trim(),late=text.match(decorated);
  const core=late?.[1]??text;
  if(/^Submitted$/i.test(core))return {...unknown,state:'submitted',isLate:!!late};
  if(/^(?:No Submission|Not Submitted)$/i.test(core))return {...unknown,state:'not_submitted'};
  const grade=core.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if(!grade)return {...unknown};
  // A joined decimal maximum and duration can have several valid splits. The
  // status is graded, but do not invent an exact score/maximum from that text.
  const ambiguous=!!late&&text.length===core.length+late[2].length;
  return {state:'graded',isLate:!!late,gradeScore:ambiguous?null:grade[1],gradeMax:ambiguous?null:grade[2],gradeDisplay:ambiguous?null:`${grade[1]} / ${grade[2]}`};
}

export function normalizeGradescopeResult<T extends GradescopeAssignmentV1>(value:T):T{
  if(value.state!=='unknown')return value;
  const parsed=parseGradescopeStatus(value.sourceStatusText);
  return parsed.state==='unknown'?value:{...value,...parsed,isLate:value.isLate||parsed.isLate};
}

/** Correct saved interpretation without writing data or changing its check time. */
export function normalizeSavedGradescopeAssignment(value:Assignment):Assignment{
  if(value.source!=='gradescope'||value.status!=='unknown'||(value.submissionStatus&&value.submissionStatus.state!=='unknown'))return value;
  const parsed=parseGradescopeStatus(value.sourceStatusText);
  if(parsed.state==='unknown')return value;
  return {...value,status:parsed.state==='not_submitted'?'pending':parsed.state==='graded'?'graded':'submitted',
    gradeScore:value.gradeScore??parsed.gradeScore,gradeMax:value.gradeMax??parsed.gradeMax,gradeDisplay:value.gradeDisplay??parsed.gradeDisplay,
    submissionStatus:value.submissionStatus?{...value.submissionStatus,state:parsed.state,isLate:value.submissionStatus.isLate||parsed.isLate}:null};
}
