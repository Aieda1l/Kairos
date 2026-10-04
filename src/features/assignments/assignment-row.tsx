"use client";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Assignment } from "@/lib/assignments/types";
import { formatDueDate } from "@/lib/dates/format";
import { SubmissionStatusBadge } from "@/features/submission-status/submission-status-badge";
import { SourceBadge } from "./source-badge";
import { AssignmentDetailDialog } from "./assignment-detail-dialog";

export function AssignmentRow({assignment,timeZone}:{assignment:Assignment;timeZone:string}){
  const [open,setOpen]=useState(false);
  return (
    <>
      <article className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:flex-row sm:items-center">
        <button
          type="button"
          className="min-w-0 flex-1 rounded-lg text-left"
          onClick={()=>setOpen(true)}
          aria-label={`View ${assignment.title} details`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{assignment.courseName}</p>
          <h3 className="truncate font-semibold">{assignment.title}</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">{formatDueDate(assignment.dueAt,timeZone)}</p>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge source={assignment.source}/>
          <SubmissionStatusBadge status={assignment.submissionStatus}/>
          {assignment.sourceUrl&&(
            <a
              href={assignment.sourceUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${assignment.title} in ${assignment.source}`}
              className="grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-[var(--surface-muted)]"
            >
              <ExternalLink size={17}/>
            </a>
          )}
        </div>
      </article>
      <AssignmentDetailDialog assignment={assignment} timeZone={timeZone} open={open} onClose={()=>setOpen(false)}/>
    </>
  );
}
