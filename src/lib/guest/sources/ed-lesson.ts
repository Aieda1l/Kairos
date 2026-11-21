import {z} from "zod";
import {normalizeSourceAssignment} from "@/lib/assignments/normalize";
import type {SourceAssignment} from "@/lib/sources/types";
import {guestUtcDateSchema} from "../schema";
import type {GuestEdLessonsResponse} from "./contracts";

const zonedDateSchema=z.iso.datetime({offset:true});

function normalizeEdTimestamp(value:string|null):string|null{
  if(value===null||guestUtcDateSchema.safeParse(value).success)return value;

  const iso=value.replace(/^(\d{4}-\d{2}-\d{2}) /,"$1T").replace(/([+-]\d{2})(\d{2})$/,"$1:$2");
  // Keep unrecognized values for the strict response validator to reject.
  if(!zonedDateSchema.safeParse(iso).success)return value;

  const timestamp=Date.parse(iso);
  return Number.isFinite(timestamp)?new Date(timestamp).toISOString():value;
}

export function normalizeGuestEdLesson(row:SourceAssignment,courseId:string):GuestEdLessonsResponse["lessons"][number]{
  const {courseName,...lesson}=normalizeSourceAssignment("ed",row);
  void courseName;
  return {
    ...lesson,
    source:"ed",
    courseId,
    sourceUrl:null,
    releaseAt:normalizeEdTimestamp(lesson.releaseAt),
    dueAt:normalizeEdTimestamp(lesson.dueAt),
    sourceUpdatedAt:normalizeEdTimestamp(lesson.sourceUpdatedAt),
  };
}
