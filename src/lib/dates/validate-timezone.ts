const validatedTimeZones=new Set<string>();
const MAX_VALIDATED_TIME_ZONES=128;

export function validateTimeZone(value:string):string{
  const trimmed=value.trim();
  if(validatedTimeZones.has(trimmed))return trimmed;
  try{
    new Intl.DateTimeFormat("en-US",{timeZone:trimmed}).format(new Date());
  }catch{
    throw new Error("INVALID_TIMEZONE: Enter a valid IANA timezone.");
  }
  // ICU zone validity is stable within an isolate. Retain only a bounded set
  // of successful public identifiers, never invalid user-supplied values.
  if(validatedTimeZones.size>=MAX_VALIDATED_TIME_ZONES){
    const oldest=validatedTimeZones.values().next().value;
    if(oldest!==undefined)validatedTimeZones.delete(oldest);
  }
  validatedTimeZones.add(trimmed);
  return trimmed;
}
