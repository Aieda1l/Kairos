"use client";
import { useMemo, useState } from "react";
import type { Assignment } from "@/lib/assignments/types";
import { AssignmentFilterBar, type FilterState } from "./assignment-filter-bar";
import { SourceBadge } from "./source-badge";
import { AssignmentDetailDialog } from "./assignment-detail-dialog";
import { AssignmentStatusBadge, assignmentStatusLabel } from "./assignment-status-badge";
import { formatDueDate } from "@/lib/dates/format";
import { Table, Th, Td } from "@/components/ui/table";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export function AssignmentTable({assignments,timeZone}:{assignments:Assignment[];timeZone:string}){
  const [filters,setFilters]=useState<FilterState>({course:"",source:"",search:""});
  const [sort,setSort]=useState<"due"|"status">("due");
  const [selected,setSelected]=useState<Assignment|null>(null);
  const courses=[...new Set(assignments.map(a=>a.courseName))].sort();

  const visible=useMemo(()=>assignments
    .filter(a=>
      (!filters.course||a.courseName===filters.course)&&
      (!filters.source||a.source===filters.source)&&
      (!filters.search||`${a.title} ${a.courseName}`.toLowerCase().includes(filters.search.toLowerCase()))
    )
    .sort((a,b)=>{
      if(sort==="status"){
        const left=assignmentStatusLabel(a);
        const right=assignmentStatusLabel(b);
        const comparison=left.localeCompare(right);
        if(comparison) return comparison;
      }
      const av=a.dueAt?Date.parse(a.dueAt):Number.POSITIVE_INFINITY;
      const bv=b.dueAt?Date.parse(b.dueAt):Number.POSITIVE_INFINITY;
      return av-bv||a.title.localeCompare(b.title);
    }),[assignments,filters,sort]);

  return (
    <div className="space-y-4">
      <AssignmentFilterBar courses={courses} value={filters} onChange={setFilters}/>
      <div className="flex items-end gap-2">
        <div>
          <Label htmlFor="sort-assignments">Sort by</Label>
          <Select id="sort-assignments" value={sort} onChange={e=>setSort(e.target.value as "due"|"status")}>
            <option value="due">Due date</option>
            <option value="status">Status</option>
          </Select>
        </div>
        <span className="pb-3 text-sm text-[var(--muted)]">{visible.length} assignment{visible.length===1?"":"s"}</span>
      </div>
      <div className="hidden overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] sm:block">
        <Table>
          <thead><tr><Th>Assignment</Th><Th>Course</Th><Th>Due</Th><Th>Source</Th><Th>Status</Th><Th>Grade</Th></tr></thead>
          <tbody>
            {visible.map(a=>(
              <tr key={a.id}>
                <Td>
                  <button type="button" aria-label={`View ${a.title} details`} className="min-h-11 text-left font-medium" onClick={()=>setSelected(a)}>
                    {a.title}
                  </button>
                </Td>
                <Td>{a.courseName}</Td>
                <Td>{formatDueDate(a.dueAt,timeZone)}</Td>
                <Td><SourceBadge source={a.source}/></Td>
                <Td><AssignmentStatusBadge assignment={a}/></Td>
                <Td>{a.gradeDisplay??"—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <div className="grid gap-2 sm:hidden">
        {visible.map(a=>(
          <button
            key={a.id}
            type="button"
            aria-label={`View ${a.title} details`}
            onClick={()=>setSelected(a)}
            className="min-h-11 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left"
          >
            <strong>{a.title}</strong>
            <span className="mt-1 block text-sm text-[var(--muted)]">{a.courseName} · {formatDueDate(a.dueAt,timeZone)}</span>
            {a.gradeDisplay&&<span className="mt-1 block text-sm">Grade {a.gradeDisplay}</span>}
          </button>
        ))}
      </div>
      {selected&&<AssignmentDetailDialog assignment={selected} timeZone={timeZone} open onClose={()=>setSelected(null)}/>}
    </div>
  );
}
