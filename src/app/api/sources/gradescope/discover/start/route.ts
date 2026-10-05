import { getDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { startGradescopeDiscovery } from "@/lib/gradescope/discovery-service";

export async function POST(){
  const db=getDatabase();
  migrate(db);
  return Response.json(startGradescopeDiscovery(db));
}
