import {AssignmentExplorer} from "@/features/assignments/assignment-explorer";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SettingsRepository} from "@/lib/db/d1/repositories/settings";
import {getSourceRuntimeContext} from "@/lib/platform/source-runtime";

export default async function UpcomingPage(){
  const {db,scope}=await getSourceRuntimeContext();
  const [assignments,connection,timeZone]=await Promise.all([
    new D1AssignmentRepository(db,scope).list(),
    new D1SourceConnectionRepository(db,scope).getByKind("canvas"),
    new D1SettingsRepository(db,scope).getTimeZone(),
  ]);

  return <div>
    <header className="mb-6">
      <p className="text-sm text-[var(--muted)]">What needs attention next</p>
      <h1 className="text-2xl font-semibold tracking-tight">Upcoming</h1>
    </header>
    <AssignmentExplorer
      assignments={assignments}
      timeZone={timeZone}
      canvasConnected={Boolean(connection?.enabled)}
    />
  </div>;
}
