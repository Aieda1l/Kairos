import { describe, expect, it } from "vitest";
import { requireUserScope } from "@/lib/auth/user-scope";
import {
  ALICE,
  BOB,
  openTenantTestDatabase,
  sessionFor,
} from "../helpers/test-users";

describe("tenant scope contract",()=>{
  it("keeps independent authenticated users distinct",async()=>{
    await expect(requireUserScope(async()=>sessionFor(ALICE))).resolves.toEqual({userId:ALICE.id});
    await expect(requireUserScope(async()=>sessionFor(BOB))).resolves.toEqual({userId:BOB.id});
  });

  it("does not construct scope from request JSON without a session user id",async()=>{
    const requestBody={userId:BOB.id};
    await expect(requireUserScope(async()=>({
      user:{name:"Alice"},
      requestBody,
    } as never))).rejects.toMatchObject({code:"AUTH_REQUIRED"});
  });

  it("rejects an Alice-child/Bob-parent cross-tenant association at the database layer",()=>{
    const db=openTenantTestDatabase();
    const now="2026-10-06T00:00:00.000Z";

    db.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)")
      .run(ALICE.id,ALICE.name,ALICE.email);
    db.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)")
      .run(BOB.id,BOB.name,BOB.email);

    db.prepare(`
      INSERT INTO source_connections(
        user_id,id,kind,label,enabled,last_sync_status,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?)
    `).run(ALICE.id,"source-alice","canvas","Canvas",1,"never",now,now);

    expect(()=>db.prepare(`
      INSERT INTO assignments(
        user_id,id,source_connection_id,source_kind,external_id,course_name,title,status,
        first_seen_at,last_seen_at,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      BOB.id,
      "assignment-cross",
      "source-alice",
      "canvas",
      "external-cross",
      "CSE 000",
      "Cross tenant",
      "pending",
      now,now,now,now,
    )).toThrow(/foreign key/i);

    db.close();
  });
});
