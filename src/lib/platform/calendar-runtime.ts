import "server-only";
import type {LegacyDatabase} from "@/lib/db/legacy-types";
import {
  getSourceRuntimeContext,
  resolveSourceRuntimeContext,
  type ResolveSourceRuntimeInput,
  type SourceRuntimeContext,
} from "@/lib/platform/source-runtime";

export type CalendarRuntimeContext=SourceRuntimeContext;
export type ResolveCalendarRuntimeInput=ResolveSourceRuntimeInput;

export type CalendarRouteRuntime=
  |{kind:"legacy";db:LegacyDatabase}
  |({kind:"hosted"}&CalendarRuntimeContext);

export function shouldUseLegacyCalendarRuntime():boolean{
  return false;
}

export function resolveCalendarRuntimeContext(
  input:ResolveCalendarRuntimeInput,
):Promise<CalendarRuntimeContext>{
  return resolveSourceRuntimeContext(input);
}

export function getCalendarRuntimeContext():Promise<CalendarRuntimeContext>{
  return getSourceRuntimeContext();
}

export async function getCalendarRouteRuntime():Promise<CalendarRouteRuntime>{
  return {kind:"hosted",...await getCalendarRuntimeContext()};
}
