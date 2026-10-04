import { expect, it } from "vitest";
import { openDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { SourceCredentialRepository } from "@/lib/db/repositories/source-credentials";
it("stores a Canvas credential outside public source models", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO source_connections(id,kind,label,enabled,last_sync_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("canvas-1","canvas","Canvas",1,"never",now,now);
  const repo = new SourceCredentialRepository(db);
  repo.setCanvasFeedUrl("canvas-1","https://canvas.example.edu/private.ics");
  expect(repo.getCanvasFeedUrl("canvas-1")).toBe("https://canvas.example.edu/private.ics");
  db.close();
});
