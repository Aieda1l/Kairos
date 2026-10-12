import {withOwnedOperation,withBridgeCompletion} from "@/lib/abuse/operation-lock";
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
  function setup(){
    const database=openD1TestDatabase();
    database.sqlite.prepare("INSERT INTO users(id) VALUES (?),(?)").run(ALICE.id,BOB.id);
    return database;
  }
  const at=new Date("2026-10-06T05:01:00.000Z");
  const scope={userId:ALICE.id};
  async function register(db:ReturnType<typeof setup>["db"],requestId:string,kind:"gradescope_discovery"|"gradescope_sync"|"canvas_submission",payload:unknown){
    return withOwnedOperation(db,scope,kind==="canvas_submission"?"source:canvas":"source:gradescope",()=>new D1SyncRequestRepository(db,scope).register({requestId,kind,payload,createdAt:"2026-10-06T05:00:00.000Z",expiresAt:"2026-10-06T05:10:00.000Z"}));
  }
  it("survives separate repository instances and isolates actors",async()=>{
    const {db,close}=setup();const requestId=crypto.randomUUID();
    await register(db,requestId,"gradescope_discovery",{courseIds:["123"]});
    const consume=()=>new D1SyncRequestRepository(db,scope).consume(requestId,"gradescope_discovery",at);
    await expect(withBridgeCompletion(db,{userId:BOB.id},requestId,"gradescope_discovery",at,consume)).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    await expect(withBridgeCompletion(db,scope,requestId,"gradescope_discovery",at,consume)).resolves.toMatchObject({requestId,kind:"gradescope_discovery",payload:{courseIds:["123"]}});
    await expect(withBridgeCompletion(db,scope,requestId,"gradescope_discovery",at,consume)).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    close();
  });
  it("fails closed for expiry and kind mismatch without consuming a valid request",async()=>{
    const {db,sqlite,close}=setup();const requestId=crypto.randomUUID();const repo=new D1SyncRequestRepository(db,scope);
    await register(db,requestId,"gradescope_sync",{connectionId:"source-a"});
    await expect(withBridgeCompletion(db,scope,requestId,"gradescope_sync",at,()=>repo.consume(requestId,"canvas_submission",at))).resolves.toBeNull();
    await expect(withBridgeCompletion(db,scope,requestId,"gradescope_sync",at,()=>repo.consume(requestId,"gradescope_sync",at))).resolves.toMatchObject({payload:{connectionId:"source-a"}});
    const expired=crypto.randomUUID();await register(db,expired,"gradescope_discovery",{});
    await expect(withBridgeCompletion(db,scope,expired,"gradescope_discovery",new Date("2026-10-06T05:10:00.001Z"),()=>repo.consume(expired,"gradescope_discovery",at))).rejects.toMatchObject({code:"SYNC_RECOVERY_REQUIRED"});
    expect(sqlite.prepare("SELECT state FROM operation_locks").get()).toEqual({state:"uncertain"});close();
  });
  it("allows exactly one winner across concurrent consumes",async()=>{
    const {db,close}=setup();const requestId=crypto.randomUUID();await register(db,requestId,"canvas_submission",{assignmentIds:["a1"]});
    const results=await Promise.allSettled(Array.from({length:2},()=>withBridgeCompletion(db,scope,requestId,"canvas_submission",at,()=>new D1SyncRequestRepository(db,scope).consume(requestId,"canvas_submission",at))));
    expect(results.filter(result=>result.status==="fulfilled"&&result.value)).toHaveLength(1);
    expect(results.filter(result=>result.status==="rejected"||(result.status==="fulfilled"&&result.value===null))).toHaveLength(1);close();
  });
});
