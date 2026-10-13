"use client";
import {useId} from 'react';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {validateTimeZone} from '@/lib/dates/validate-timezone';
export function TimezoneControl({value,onChange,disabled=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean}){
  const id=useId();
  // Suggestions are stable across server/browser ICU versions. The input
  // accepts any valid IANA identifier, including zones outside these hints.
  const zones=['UTC','America/Los_Angeles','America/Denver','America/Chicago','America/New_York','Europe/London','Asia/Kathmandu','Australia/Sydney'];
  let valid=true;try{validateTimeZone(value);}catch{valid=false;}
  return <div className="min-w-0 flex-1"><Label htmlFor={id}>Display timezone</Label>
    <Input id={id} value={value} onChange={e=>onChange(e.target.value)} list={id+'-zones'} disabled={disabled} autoComplete="off" aria-invalid={!valid} aria-describedby={id+'-help'}/>
    <datalist id={id+'-zones'}>{zones.map(zone=><option key={zone} value={zone}/>)}</datalist>
    <p id={id+'-help'} className="mt-2 text-sm text-[var(--muted)]">{valid?'Choose or type an IANA timezone, such as Asia/Kathmandu.':'Choose a valid IANA timezone.'}</p>
  </div>;
}
