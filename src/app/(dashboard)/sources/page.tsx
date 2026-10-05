import {getDatabase} from "@/lib/db/client";
import {migrate} from "@/lib/db/migrate";
import {SourceConnectionRepository} from "@/lib/db/repositories/source-connections";
import {CanvasSourceCard} from "@/features/sources/canvas-source-card";
import {GradescopeSourceCard} from "@/features/sources/gradescope-source-card";
import {EdSourceCard} from "@/features/sources/ed-source-card";

export default function SourcesPage(){
  const db=getDatabase();
  migrate(db);
  const canvas=new SourceConnectionRepository(db).getByKind("canvas");
  return <div>
    <header className="mb-6">
      <p className="text-sm text-[var(--muted)]">Connections</p>
      <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
        Bring deadlines into one local dashboard. Source credentials stay on this computer.
      </p>
    </header>
    <div className="grid gap-4">
      <CanvasSourceCard connection={canvas}/>
      <GradescopeSourceCard/>
      <EdSourceCard/>
    </div>
  </div>;
}
