import { describe, expect, it } from "vitest";
import { GradescopeRequestRegistry } from "@/lib/gradescope/request-registry";
import { D1SyncRequestRepository } from "@/lib/db/d1/repositories/sync-requests";
import { ALICE, BOB } from "../helpers/test-users";
import { openD1TestDatabase } from "../helpers/d1-test-db";

describe("GradescopeRequestRegistry",()=>{
  it("consumes a registered discovery request once",()=>{
    const registry=new GradescopeRequestRegistry();
    registry.register({
      requestId:"11111111-1111-4111-8111-111111111111",
      kind:"discovery",
      connectionId:null,
      courseIds:[],
      startedAt:"2026-10-05T05:00:00.000Z",
    });
    expect(registry.consume("11111111-1111-4111-8111-111111111111",Date.parse("2026-10-05T05:09:59.000Z"))).toMatchObject({kind:"discovery"});
    expect(registry.consume("11111111-1111-4111-8111-111111111111",Date.parse("2026-10-05T05:10:00.000Z"))).toBeNull();
  });

  it("expires requests after ten minutes",()=>{
    const registry=new GradescopeRequestRegistry();
    registry.register({
      requestId:"22222222-2222-4222-8222-222222222222",
      kind:"discovery",
      connectionId:null,
      courseIds:[],
      startedAt:"2026-10-05T05:00:00.000Z",
    });
    expect(registry.consume("22222222-2222-4222-8222-222222222222",Date.parse("2026-10-05T05:10:00.001Z"))).toBeNull();
  });
});


describe("durable D1 sync request state",()=>{
  async function setup(){
    const database=openD1TestDatabase();
    const {db,sqlite}=database;
    sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)").run(ALICE.id,ALICE.name,ALICE.email);
    sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)").run(BOB.id,BOB.name,BOB.email);
    return database;
  }

  it("survives separate repository instances and isolates Alice from Bob",async()=>{
    const {db,close}=await setup();
    const requestId="33333333-3333-4333-8333-333333333333";
    const createdAt="2026-10-06T05:00:00.000Z";
    const expiresAt="2026-10-06T05:10:00.000Z";
    const aliceA=new D1SyncRequestRepository(db,{userId:ALICE.id});
    const aliceB=new D1SyncRequestRepository(db,{userId:ALICE.id});
    const bob=new D1SyncRequestRepository(db,{userId:BOB.id});

    await aliceA.register({
      requestId,
      kind:"gradescope_discovery",
      payload:{courseIds:["123"]},
      createdAt,
      expiresAt,
    });

    await expect(bob.consume(requestId,"gradescope_discovery",new Date("2026-10-06T05:01:00.000Z")))
      .resolves.toBeNull();
    await expect(aliceB.consume(requestId,"gradescope_discovery",new Date("2026-10-06T05:01:00.000Z")))
      .resolves.toMatchObject({requestId,kind:"gradescope_discovery",payload:{courseIds:["123"]}});
    await expect(aliceA.consume(requestId,"gradescope_discovery",new Date("2026-10-06T05:02:00.000Z")))
      .resolves.toBeNull();
    close();
  });

  it("fails closed for expiry and kind mismatch without consuming the valid request",async()=>{
    const {db,close}=await setup();
    const repo=new D1SyncRequestRepository(db,{userId:ALICE.id});

    await repo.register({
      requestId:"44444444-4444-4444-8444-444444444444",
      kind:"gradescope_sync",
      payload:{connectionId:"source-a"},
      createdAt:"2026-10-06T05:00:00.000Z",
      expiresAt:"2026-10-06T05:10:00.000Z",
    });
    await expect(repo.consume(
      "44444444-4444-4444-8444-444444444444",
      "canvas_submission",
      new Date("2026-10-06T05:01:00.000Z"),
    )).resolves.toBeNull();
    await expect(repo.consume(
      "44444444-4444-4444-8444-444444444444",
      "gradescope_sync",
      new Date("2026-10-06T05:01:00.000Z"),
    )).resolves.toMatchObject({payload:{connectionId:"source-a"}});

    await repo.register({
      requestId:"55555555-5555-4555-8555-555555555555",
      kind:"gradescope_discovery",
      payload:{},
      createdAt:"2026-10-06T05:00:00.000Z",
      expiresAt:"2026-10-06T05:10:00.000Z",
    });
    await expect(repo.consume(
      "55555555-5555-4555-8555-555555555555",
      "gradescope_discovery",
      new Date("2026-10-06T05:10:00.001Z"),
    )).resolves.toBeNull();
    close();
  });

  it("allows exactly one winner across concurrent consumes",async()=>{
    const {db,close}=await setup();
    const requestId="66666666-6666-4666-8666-666666666666";
    const first=new D1SyncRequestRepository(db,{userId:ALICE.id});
    const second=new D1SyncRequestRepository(db,{userId:ALICE.id});
    await first.register({
      requestId,
      kind:"canvas_submission",
      payload:{assignmentIds:["a1"]},
      createdAt:"2026-10-06T05:00:00.000Z",
      expiresAt:"2026-10-06T05:10:00.000Z",
    });

    const results=await Promise.all([
      first.consume(requestId,"canvas_submission",new Date("2026-10-06T05:01:00.000Z")),
      second.consume(requestId,"canvas_submission",new Date("2026-10-06T05:01:00.000Z")),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter(result=>result===null)).toHaveLength(1);
    close();
  });
});
