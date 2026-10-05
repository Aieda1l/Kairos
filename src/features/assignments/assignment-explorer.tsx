"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Assignment } from "@/lib/assignments/types";
import { groupUpcoming } from "@/lib/assignments/queries";
import type { DueGroup } from "@/lib/dates/classify-due-date";
import { ConnectedSourceSyncControls } from "@/features/sync/connected-source-sync-controls";
import { AssignmentFilterBar, type FilterState } from "./assignment-filter-bar";
import { AssignmentList } from "./assignment-list";

const order:DueGroup[]=["overdue","today","tomorrow","this-week","later","no-due-date"];
const labels:Record<DueGroup,string>={
  overdue:"Overdue",
  today:"Today",
  tomorrow:"Tomorrow",
  "this-week":"This week",
  later:"Later",
  "no-due-date":"No due date",
};

export function AssignmentExplorer({
  assignments,
  timeZone,
  canvasConnected,
  now=new Date(),
}:{
  assignments:Assignment[];
  timeZone:string;
  canvasConnected:boolean;
  now?:Date;
}){
  const [filters,setFilters]=useState<FilterState>({course:"",source:"",search:""});
  const courses=useMemo(()=>[...new Set(assignments.map(a=>a.courseName))].sort(),[assignments]);
  const filtered=useMemo(()=>assignments.filter(a=>
    (!filters.course||a.courseName===filters.course)&&
    (!filters.source||a.source===filters.source)&&
    (!filters.search||`${a.title} ${a.courseName}`.toLowerCase().includes(filters.search.toLowerCase()))
  ),[assignments,filters]);
  const groups=groupUpcoming(filtered,now,timeZone);

  if(assignments.length===0){
    return (
      <div className="space-y-5">
        <ConnectedSourceSyncControls canvasConnected={canvasConnected}/>
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center">
          <h2 className="font-semibold">No assignments yet</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">Connect a source or run a sync to fill your dashboard.</p>
          <Link className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[var(--accent)] px-4 font-medium text-white" href="/sources">Connect a source</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ConnectedSourceSyncControls canvasConnected={canvasConnected}/>
      <AssignmentFilterBar courses={courses} value={filters} onChange={setFilters}/>
      {order.map(key=>groups[key].length>0&&(
        <section key={key}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {labels[key]} <span className="font-normal">{groups[key].length}</span>
          </h2>
          <AssignmentList assignments={groups[key]} timeZone={timeZone}/>
        </section>
      ))}
    </div>
  );
}
