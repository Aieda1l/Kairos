import "server-only";
import type Database from "better-sqlite3";
import {
  getSourceRuntimeContext,
  resolveSourceRuntimeContext,
  type ResolveSourceRuntimeInput,
  type SourceRuntimeContext,
} from "@/lib/platform/source-runtime";

export type CalendarRuntimeContext=SourceRuntimeContext;
export type ResolveCalendarRuntimeInput=ResolveSourceRuntimeInput;

export type CalendarRouteRuntime=
  |{kind:"legacy";db:Database.Database}
  |({kind:"hosted"}&CalendarRuntimeContext);

export function shouldUseLegacyCalendarRuntime(
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

export async function getCalendarRouteRuntime():Promise<CalendarRouteRuntime>{
  if(shouldUseLegacyCalendarRuntime()){
    const [{getDatabase},{migrate}]=await Promise.all([
      import("@/lib/db/client"),
      import("@/lib/db/migrate"),
    ]);
    const db=getDatabase();
    migrate(db);
    return {kind:"legacy",db};
  }
  return {kind:"hosted",...await getCalendarRuntimeContext()};
}
