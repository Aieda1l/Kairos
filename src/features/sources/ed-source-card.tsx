"use client";

import { useEffect, useState } from "react";
import type { SourceConnection } from "@/lib/assignments/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useEd } from "@/features/ed/ed-provider";
import { SourceStatus } from "./source-status";

export function EdSourceCard(){
  const ed=useEd();
  const [token,setToken]=useState("");
  const [selected,setSelected]=useState<string[]>(
    ed.courses.filter(course=>course.enabled).map(course=>course.externalCourseId),
  );

  useEffect(()=>{
    setSelected(ed.courses.filter(course=>course.enabled).map(course=>course.externalCourseId));
  },[ed.courses]);

  const busy=["testing","connecting","refreshing","syncing"].includes(ed.phase);
  const statusConnection:SourceConnection|null=ed.connection?{
    ...ed.connection,
    lastSyncStartedAt:ed.lastAttemptedAt??ed.connection.lastSyncStartedAt,
    lastSyncCompletedAt:ed.lastSuccessfulAt??ed.connection.lastSyncCompletedAt,
    lastSyncStatus:ed.lastSuccessfulAt
      ?ed.lastErrorCode&&ed.lastErrorCode!=="PARTIAL_SYNC"?"error":"success"
      :ed.connection.lastSyncStatus,
    lastErrorCode:ed.lastErrorCode??ed.connection.lastErrorCode,
  }:null;

  function toggle(courseId:string,checked:boolean){
    setSelected(current=>checked
      ?Array.from(new Set([...current,courseId]))
      :current.filter(id=>id!==courseId));
  }

  async function saveToken(){
    if(!token.trim())return;
    const ok=await ed.connect(token);
    if(ok)setToken("");
  }

  return <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">Ed</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Read visible Ed Lessons through Ed&apos;s API. The connector is read-only, and the API token stays in Kairos&apos;s local credential store.
        </p>
      </div>
      <SourceStatus connection={statusConnection}/>
    </div>

    <div className="mt-4 grid max-w-xl gap-2">
      <label className="text-sm font-medium" htmlFor="ed-api-token">Ed API token</label>
      <input
        id="ed-api-token"
        type="password"
        autoComplete="off"
        value={token}
        onChange={event=>setToken(event.target.value)}
        placeholder={ed.connection?"Enter a new token to replace the saved token":"Paste your Ed API token"}
        className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
      />
      <p className="text-xs text-[var(--muted)]">Kairos never displays the saved token again after it is stored.</p>
    </div>

    <div className="mt-4 flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy||!token.trim()} onClick={()=>void ed.testToken(token)}>
        {ed.phase==="testing"?"Testing…":"Test connection"}
      </Button>
      <Button disabled={busy||!token.trim()} onClick={()=>void saveToken()}>
        {ed.phase==="connecting"?"Connecting…":ed.connection?"Update token":"Connect Ed"}
      </Button>
      {ed.connection&&<>
        <Button variant="secondary" disabled={busy} onClick={()=>void ed.refreshCourses()}>
          {ed.phase==="refreshing"?"Refreshing…":"Refresh courses"}
        </Button>
        <Button variant="secondary" disabled={busy||ed.courses.length===0} onClick={()=>void ed.saveEnabledCourses(selected)}>
          Save selection
        </Button>
        <Button disabled={busy||selected.length===0} onClick={()=>void ed.syncNow()}>
          {ed.phase==="syncing"?"Syncing…":"Sync Ed"}
        </Button>
      </>}
    </div>

    {ed.courses.length>0&&<fieldset className="mt-5 grid gap-2">
      <legend className="mb-1 text-sm font-medium">Courses to sync</legend>
      {ed.courses.map(course=><label
        key={course.externalCourseId}
        className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2"
      >
        <input
          type="checkbox"
          checked={selected.includes(course.externalCourseId)}
          onChange={event=>toggle(course.externalCourseId,event.target.checked)}
        />
        <span>
          <strong className="block">{course.shortName??course.fullName}</strong>
          {course.shortName&&course.fullName!==course.shortName&&<span className="block text-sm text-[var(--muted)]">{course.fullName}</span>}
        </span>
      </label>)}
    </fieldset>}

    {(ed.lastAttemptedAt||ed.lastSuccessfulAt)&&<div className="mt-4 grid gap-1 text-sm text-[var(--muted)]">
      {ed.lastAttemptedAt&&<p>Last attempted {new Date(ed.lastAttemptedAt).toLocaleString()}</p>}
      {ed.lastSuccessfulAt&&<p>Last successful {new Date(ed.lastSuccessfulAt).toLocaleString()}</p>}
    </div>}

    {ed.message&&<Alert className="mt-4">{ed.message}</Alert>}
  </section>;
}
