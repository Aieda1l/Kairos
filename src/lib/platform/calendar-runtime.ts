import "server-only";
import {
  getSourceRuntimeContext,
  resolveSourceRuntimeContext,
  type ResolveSourceRuntimeInput,
  type SourceRuntimeContext,
} from "@/lib/platform/source-runtime";

export type CalendarRuntimeContext=SourceRuntimeContext;
export type ResolveCalendarRuntimeInput=ResolveSourceRuntimeInput;

export function useLegacyCalendarRuntime(
  env:Record<string,string|undefined>=process.env,
):boolean{
  return env.KAIROS_NEXT_COMPAT_BUILD==="1"
    ||env.E2E_FIXTURES==="1"
    ||Boolean(env.ASSIGNMENTS_DB_PATH);
}

export function resolveCalendarRuntimeContext(
  input:ResolveCalendarRuntimeInput,
):Promise<CalendarRuntimeContext>{
  return resolveSourceRuntimeContext(input);
}

export function getCalendarRuntimeContext():Promise<CalendarRuntimeContext>{
  return getSourceRuntimeContext();
}
