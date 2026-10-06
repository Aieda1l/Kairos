"use client";

import {useEffect,useState} from "react";
import {Alert} from "@/components/ui/alert";
import {useCalendarSync} from "@/features/calendars/calendar-provider";
import {GoogleCalendarCard} from "./google-calendar-card";
import {MicrosoftCalendarCard} from "./microsoft-calendar-card";
import {IcloudCalendarCard} from "./icloud-calendar-card";

export function CalendarDestinations(){
  const calendars=useCalendarSync();
  const google=calendars.connections.find(x=>x.provider==="google")??null;
  const microsoft=calendars.connections.find(x=>x.provider==="microsoft")??null;
  const icloud=calendars.connections.find(x=>x.provider==="caldav")??null;
  const [hideSubmitted,setHideSubmitted]=useState(true);
  const [savingPreference,setSavingPreference]=useState(false);
  const [preferenceMessage,setPreferenceMessage]=useState("");

  useEffect(()=>{
    let active=true;
    fetch("/api/settings/calendar")
      .then(async response=>{
        if(!response.ok)throw new Error();
        return response.json() as Promise<{hideSubmitted?:unknown}>;
      })
      .then(body=>{
        if(active&&typeof body.hideSubmitted==="boolean"){
          setHideSubmitted(body.hideSubmitted);
        }
      })
      .catch(()=>{
        if(active)setPreferenceMessage(
          "Calendar visibility preference could not be loaded; submitted assignments remain hidden by default.",
        );
      });
    return ()=>{active=false;};
  },[]);

  async function updateHideSubmitted(next:boolean){
    const previous=hideSubmitted;
    setHideSubmitted(next);
    setSavingPreference(true);
    setPreferenceMessage("");
    try{
      const response=await fetch("/api/settings/calendar",{
        method:"PUT",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({hideSubmitted:next}),
      });
      const body=await response.json().catch(()=>({})) as {hideSubmitted?:unknown;message?:unknown};
      if(!response.ok||body.hideSubmitted!==next){
        throw new Error(
          typeof body.message==="string"
            ?body.message
            :"Calendar visibility preference could not be saved.",
        );
      }
      await calendars.syncAll();
      setPreferenceMessage(
        next
          ?"Submitted, graded, and excused assignments are hidden from calendar destinations."
          :"Submitted assignments remain visible in calendar destinations.",
      );
    }catch(error){
      setHideSubmitted(previous);
      setPreferenceMessage(
        error instanceof Error
          ?error.message
          :"Calendar visibility preference could not be saved.",
      );
    }finally{
      setSavingPreference(false);
    }
  }

  return (
    <section className="mt-8">
      <div className="mb-4">
        <p className="text-sm text-[var(--muted)]">Outbound sync</p>
        <h2 className="text-xl font-semibold">Calendar destinations</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          Sources bring assignments into Kairos. Calendar destinations publish Kairos deadlines to calendars you already use.
        </p>
      </div>

      <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={hideSubmitted}
            disabled={savingPreference}
            onChange={event=>void updateHideSubmitted(event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block font-medium">Hide submitted assignments</span>
            <span className="mt-1 block text-sm text-[var(--muted)]">
              On by default. Submitted, graded, and excused work is removed from generated calendar events and returns if the assignment becomes active again.
            </span>
          </span>
        </label>
        {savingPreference&&(
          <p className="mt-2 text-sm text-[var(--muted)]">Saving and resynchronizing calendars…</p>
        )}
        {preferenceMessage&&<Alert className="mt-3">{preferenceMessage}</Alert>}
      </div>

      <div className="grid gap-4">
        <GoogleCalendarCard connection={google}/>
        <MicrosoftCalendarCard connection={microsoft}/>
        <IcloudCalendarCard connection={icloud}/>
      </div>
    </section>
  );
}
