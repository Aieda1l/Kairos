import { expect, it } from "vitest";
import { openDatabase } from "../helpers/legacy-db";
import { migrate } from "../helpers/legacy-db";
import { SourceCredentialRepository } from "@/lib/db/repositories/source-credentials";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
it("stores a Canvas credential outside public source models", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO source_connections(id,kind,label,enabled,last_sync_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("canvas-1","canvas","Canvas",1,"never",now,now);
  const repo = new SourceCredentialRepository(db);
  repo.setCanvasFeedUrl("canvas-1","https://canvas.example.edu/private.ics");
  expect(repo.getCanvasFeedUrl("canvas-1")).toBe("https://canvas.example.edu/private.ics");
  db.close();
});


it("stores an Ed credential outside public source models", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const connection = new SourceConnectionRepository(db).upsertEd("Ed");
  const repo = new SourceCredentialRepository(db);
  const token = "fixture-ed-token-never-echo";
  repo.setEdApiToken(connection.id, token);
  expect(repo.getEdApiToken(connection.id)).toBe(token);
  expect(connection.kind).toBe("ed");
  expect(JSON.stringify(connection)).not.toContain(token);
  expect(connection).not.toHaveProperty("edApiToken");
  db.close();
});
