"use client";
import type { Assignment } from "@/lib/assignments/types";
import { Dialog } from "@/components/ui/dialog";
import { SubmissionStatusBadge } from "@/features/submission-status/submission-status-badge";
import { SourceBadge } from "./source-badge";
import { formatDueDate } from "@/lib/dates/format";

function formatTimestamp(value:string,timeZone:string):string {
  return new Date(value).toLocaleString("en-US",{timeZone});
}

export function AssignmentDetailDialog({
  assignment,
  timeZone,
  open,
  onClose,
}:{
  assignment:Assignment;
  timeZone:string;
  open:boolean;
  onClose:()=>void;
}){
  const status=assignment.submissionStatus;
  return (
    <Dialog open={open} onClose={onClose} title={assignment.title}>
      <dl className="grid gap-3 text-sm">
        <div><dt className="text-[var(--muted)]">Course</dt><dd>{assignment.courseName}</dd></div>
        <div><dt className="text-[var(--muted)]">Due</dt><dd>{formatDueDate(assignment.dueAt,timeZone)}</dd></div>
        <div><dt className="text-[var(--muted)]">Source</dt><dd className="mt-1"><SourceBadge source={assignment.source}/></dd></div>
        <div><dt className="text-[var(--muted)]">Submission status</dt><dd className="mt-1"><SubmissionStatusBadge status={status}/></dd></div>
        {status?.submittedAt&&(
          <div><dt className="text-[var(--muted)]">Submitted at</dt><dd>{formatTimestamp(status.submittedAt,timeZone)}</dd></div>
        )}
        {status?.checkedAt&&(
          <div><dt className="text-[var(--muted)]">Checked</dt><dd>{formatTimestamp(status.checkedAt,timeZone)}</dd></div>
        )}
      </dl>
      {assignment.sourceUrl&&(
        <a
          className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[var(--accent)] px-4 font-medium text-white"
          href={assignment.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open in {assignment.source==="canvas"?"Canvas":assignment.source}
        </a>
      )}
    </Dialog>
  );
}
