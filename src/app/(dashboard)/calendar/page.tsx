import {AssignmentCalendar} from "@/features/assignments/assignment-calendar";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1SettingsRepository} from "@/lib/db/d1/repositories/settings";
import {getSourceRuntimeContext} from "@/lib/platform/source-runtime";

export default async function CalendarPage(){
  const {db,scope}=await getSourceRuntimeContext();
  const [assignments,timeZone]=await Promise.all([
    new D1AssignmentRepository(db,scope).list(),
    new D1SettingsRepository(db,scope).getTimeZone(),
  ]);

  return <div>
    <header className="mb-6">
      <p className="text-sm text-[var(--muted)]">See deadlines in context</p>
      <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
    </header>
    <AssignmentCalendar assignments={assignments} timeZone={timeZone}/>
  </div>;
}
