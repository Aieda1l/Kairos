import {CanvasSourceCard} from "@/features/sources/canvas-source-card";
import {GradescopeSourceCard} from "@/features/sources/gradescope-source-card";
import {EdSourceCard} from "@/features/sources/ed-source-card";
import {CalendarDestinations} from "@/features/sources/calendar-destinations";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {getSourceRuntimeContext} from "@/lib/platform/source-runtime";

export default async function SourcesPage(){
  const {db,scope}=await getSourceRuntimeContext();
  const canvas=await new D1SourceConnectionRepository(db,scope).getByKind("canvas");

  return <div>
    <header className="mb-6">
      <p className="text-sm text-[var(--muted)]">Connections</p>
      <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
        Bring deadlines into one dashboard. Sensitive source credentials are encrypted before hosted storage.
      </p>
    </header>
    <div className="grid gap-4">
      <CanvasSourceCard connection={canvas}/>
      <GradescopeSourceCard/>
      <EdSourceCard/>
    </div>
    <CalendarDestinations/>
  </div>;
}
