import {AssignmentTable} from "@/features/assignments/assignment-table";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1SettingsRepository} from "@/lib/db/d1/repositories/settings";
import {getSourceRuntimeContext} from "@/lib/platform/source-runtime";

export default async function AssignmentsPage(){
  const {db,scope}=await getSourceRuntimeContext();
  const [assignments,timeZone]=await Promise.all([
    new D1AssignmentRepository(db,scope).list(),
    new D1SettingsRepository(db,scope).getTimeZone(),
  ]);

  return <div>
    <header className="mb-6">
      <p className="text-sm text-[var(--muted)]">Search and sort every imported deadline</p>
      <h1 className="text-2xl font-semibold tracking-tight">All Assignments</h1>
    </header>
    <AssignmentTable assignments={assignments} timeZone={timeZone}/>
  </div>;
}
