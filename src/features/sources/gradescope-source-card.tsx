"use client";
import {RecoveryPrompts} from '@/features/recovery/recovery-prompts';
import {getRecoveryNotice} from '@/lib/recovery/presentation';


import { useState } from "react";
import type { SourceConnection } from "@/lib/assignments/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { SourceStatus } from "./source-status";
import { useGradescope } from "@/features/gradescope/gradescope-provider";
import {usePrivateDrafts} from '@/features/onboarding/private-drafts';

export function GradescopeSourceCard(){
  const gradescope=useGradescope();
  const code=gradescope.lastErrorCode??gradescope.connection?.lastErrorCode;
  const browserEnabled=Boolean(gradescope.connection?.enabled&&gradescope.courses.some(course=>course.enabled));
  const recovery=gradescope.recovery??(browserEnabled?getRecoveryNotice(code,{key:"gradescope"}):null);
  const drafts=usePrivateDrafts();
  const [localSelected,setSelected]=useState<string[]>(
    gradescope.courses.filter(course=>course.enabled).map(course=>course.externalCourseId),
  );
  const selected=drafts
    ?drafts.courseIds('gradescope')??gradescope.courses.filter(course=>course.enabled).map(course=>course.externalCourseId)
    :localSelected;


  const busy=gradescope.phase==="discovering"||gradescope.phase==="syncing";
  const statusConnection:SourceConnection|null=gradescope.connection?{
    ...gradescope.connection,
    lastSyncStatus:gradescope.lastSuccessfulAt
      ?gradescope.lastErrorCode&&gradescope.lastErrorCode!=="PARTIAL_SYNC"?"error":"success"
      :"never",
    lastErrorCode:gradescope.lastErrorCode,
  }:null;

  function toggle(courseId:string,checked:boolean){
    const next=checked?Array.from(new Set([...selected,courseId])):selected.filter(id=>id!==courseId);
    if(drafts)drafts.selectCourses('gradescope',next);else setSelected(next);
  }

  async function saveSelection(){
    try{if(drafts)await drafts.progress({gradescopeCourseIds:selected});await gradescope.saveEnabledCourses(selected);}
    catch{/* Wizard retains conflict and accepted selection. */}
  }
  async function retry(){
    if(gradescope.recoveryOperation==='selection')await saveSelection();
    else if(gradescope.recoveryOperation==='discovery'||!gradescope.connection)await gradescope.discoverCourses();
    else await gradescope.syncNow();
  }
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Gradescope</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            Read assignment dates, submission state, and published grades from a Gradescope tab already signed in to Firefox.
            Kairos never asks for your Gradescope password.
          </p>
        </div>
        <SourceStatus connection={statusConnection}/>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 font-medium"
          href="https://www.gradescope.com/"
          target="_blank"
          rel="noreferrer"
        >
          Open Gradescope
        </a>
        <Button
          variant="secondary"
          onClick={()=>void gradescope.discoverCourses()}
          disabled={busy}
        >
          {gradescope.phase==="discovering"?"Discovering…":"Discover courses"}
        </Button>
        {gradescope.courses.length>0&&(
          <Button
            variant="secondary"
            onClick={()=>void saveSelection()}
            disabled={busy}
          >
            Save selection
          </Button>
        )}
        {gradescope.connection&&(
          <Button
            onClick={()=>void gradescope.syncNow()}
            disabled={busy||selected.length===0}
          >
            {gradescope.phase==="syncing"?"Syncing…":"Sync Gradescope"}
          </Button>
        )}
      </div>

      {gradescope.courses.length>0&&(
        <fieldset className="mt-5 grid gap-2">
          <legend className="mb-1 text-sm font-medium">Courses to sync</legend>
          {gradescope.courses.map(course=>(
            <label
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
                {course.shortName&&course.fullName!==course.shortName&&(
                  <span className="block text-sm text-[var(--muted)]">{course.fullName}</span>
                )}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {(gradescope.lastAttemptedAt||gradescope.lastSuccessfulAt)&&(
        <div className="mt-4 grid gap-1 text-sm text-[var(--muted)]">
          {gradescope.lastAttemptedAt&&(
            <p>Last attempted {new Date(gradescope.lastAttemptedAt).toLocaleString()}</p>
          )}
          {gradescope.lastSuccessfulAt&&(
            <p>Last successful {new Date(gradescope.lastSuccessfulAt).toLocaleString()}</p>
          )}
        </div>
      )}
      {(gradescope.extensionDetected||(gradescope.connection?.enabled&&selected.length>0))&&<p className="mt-4 text-sm text-[var(--muted)]">
        {gradescope.extensionDetected
          ?gradescope.gradescopeTabDetected
            ?"Firefox extension and Gradescope tab detected."
            :"Firefox extension detected · open a signed-in Gradescope tab to connect."
          :"Firefox extension not detected."}
      </p>}
      {recovery&&<div className="mt-4"><RecoveryPrompts notices={[recovery]} onRetry={retry}/></div>}
      {gradescope.message&&!recovery&&(
        <Alert className="mt-4 border-[var(--danger)]">{gradescope.message}</Alert>
      )}
    </section>
  );
}
