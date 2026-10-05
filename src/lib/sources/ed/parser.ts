import type { DiscoveredSourceCourse, SourceAssignment, SourceCourse } from "@/lib/sources/types";
import { EdSourceError } from "./errors";
import {
  edEnrollmentSchema,
  edLessonSchema,
  edLessonsPayloadSchema,
  edUserPayloadSchema,
} from "./schemas";

function text(value:string|null|undefined):string|null{
  const normalized=value?.trim();
  return normalized?normalized:null;
}

function idText(value:number|string|undefined):string|null{
  if(typeof value==="number")return Number.isInteger(value)&&value>0?String(value):null;
  return value&&/^\d+$/.test(value)?value:null;
}

function yearText(value:string|number|null|undefined):string|null{
  if(typeof value==="number")return String(value);
  return text(value);
}

export function parseEdCourses(payload:unknown):DiscoveredSourceCourse[]{
  const parsed=edUserPayloadSchema.safeParse(payload);
  if(!parsed.success){
    throw new EdSourceError("ED_PARSE_ERROR","Ed returned a user response Kairos could not read.");
  }

  const courses:DiscoveredSourceCourse[]=[];
  for(const entry of parsed.data.courses){
    const enrollment=edEnrollmentSchema.safeParse(entry);
    if(!enrollment.success)continue;
    const externalCourseId=idText(enrollment.data.course.id);
    const shortName=text(enrollment.data.course.code);
    const fullName=text(enrollment.data.course.name)??shortName;
    if(!externalCourseId||!fullName)continue;
    courses.push({
      externalCourseId,
      shortName,
      fullName,
      term:text(enrollment.data.course.session),
      year:yearText(enrollment.data.course.year),
    });
  }
  return courses;
}

function assignmentStatus(progress:string|null):SourceAssignment["status"]{
  if(progress==="completed")return "submitted";
  if(progress==="attempted"||progress==="unattempted")return "pending";
  return "unknown";
}

export function parseEdLessons(payload:unknown,course:SourceCourse):SourceAssignment[]{
  const parsed=edLessonsPayloadSchema.safeParse(payload);
  if(!parsed.success){
    throw new EdSourceError("ED_PARSE_ERROR","Ed returned a lessons response Kairos could not read.");
  }

  const assignments:SourceAssignment[]=[];
  for(const entry of parsed.data.lessons){
    const lesson=edLessonSchema.safeParse(entry);
    if(!lesson.success)continue;
    const externalId=idText(lesson.data.id);
    const title=text(lesson.data.title);
    if(!externalId||!title)continue;
    if(lesson.data.is_hidden===true||lesson.data.is_unlisted===true)continue;
    const rawCourseId=idText(lesson.data.course_id);
    if(rawCourseId&&rawCourseId!==course.externalCourseId)continue;

    const progress=text(lesson.data.status);
    const state=text(lesson.data.state);
    assignments.push({
      externalId,
      courseId:course.externalCourseId,
      courseName:course.shortName??course.fullName,
      title,
      releaseAt:text(lesson.data.effective_available_at)??text(lesson.data.available_at),
      dueAt:text(lesson.data.effective_due_at)??text(lesson.data.due_at),
      lateDueAt:null,
      status:assignmentStatus(progress),
      sourceStatusText:progress??state,
      gradeScore:null,
      gradeMax:null,
      gradeDisplay:null,
      sourceUrl:null,
      sourceUpdatedAt:text(lesson.data.updated_at),
    });
  }
  return assignments;
}
