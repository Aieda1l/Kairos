import { describe, expect, it, vi } from "vitest";
import { ALICE, BOB, sessionFor } from "../helpers/test-users";
import { openD1TestDatabase } from "../helpers/d1-test-db";
import type { CredentialKeyring } from "@/lib/security/credential-cipher";
import { D1SourceConnectionRepository } from "@/lib/db/d1/repositories/source-connections";
import { D1SourceCredentialRepository } from "@/lib/db/d1/repositories/source-credentials";
import { syncCanvasConnection } from "@/lib/sync/sync-source";
import { connectEd } from "@/lib/ed/discovery-service";
import {syncEdConnection} from "@/lib/ed/sync-service";
import {
  completeGradescopeDiscovery,
  startGradescopeDiscovery,
} from "@/lib/gradescope/discovery-service";
import {
  completeGradescopeSync,
  startGradescopeSync,
} from "@/lib/gradescope/sync-service";
import {
  completeCanvasSubmissionStatusSync,
  startCanvasSubmissionStatusSync,
} from "@/lib/submission-status/sync-service";
import {D1AssignmentRepository} from "@/lib/db/d1/repositories/assignments";
import {D1SourceCourseRepository} from "@/lib/db/d1/repositories/source-courses";
import { resolveSourceRuntimeContext } from "@/lib/platform/source-runtime";

const keyring:CredentialKeyring={
  activeKeyId:"k1",
  keys:{k1:new Uint8Array(32).fill(17)},
};

async function seedUsers(sqlite:ReturnType<typeof openD1TestDatabase>["sqlite"]){
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)").run(ALICE.id,ALICE.name,ALICE.email);
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)").run(BOB.id,BOB.name,BOB.email);
}

describe("hosted source tenant boundary",()=>{
  it("derives scope from the session and rejects unauthenticated/client-selected identity",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedUsers(sqlite);

    await expect(resolveSourceRuntimeContext({
      db,
      keyring,
      getSession:async()=>sessionFor(ALICE),
    })).resolves.toMatchObject({scope:{userId:ALICE.id}});

    await expect(resolveSourceRuntimeContext({
      db,
      keyring,
      getSession:async()=>null,
      requestBody:{userId:BOB.id},
    } as never)).rejects.toMatchObject({code:"AUTH_REQUIRED"});
    close();
  });

  it("does not let Bob sync Alice's Canvas connection even with its exact id",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedUsers(sqlite);
    const aliceScope={userId:ALICE.id};
    const bobScope={userId:BOB.id};
    const connection=await new D1SourceConnectionRepository(db,aliceScope).upsertCanvas("Alice Canvas");
    await new D1SourceCredentialRepository(db,aliceScope,keyring)
      .setCanvasFeedUrl(connection.id,"https://canvas.example.invalid/alice.ics");

    const sourceFactory=vi.fn(()=>({
      async sync(){return [];},
      getLastParseReport(){return {skipped:0,errors:[]};},
    }));

    await expect(syncCanvasConnection(connection.id,{
      db,
      scope:bobScope,
      keyring,
      sourceFactory:sourceFactory as never,
    })).rejects.toMatchObject({code:"CANVAS_NOT_CONFIGURED"});
    expect(sourceFactory).not.toHaveBeenCalled();
    close();
  });

  it("keeps Alice's encrypted Ed token when a replacement token fails validation",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedUsers(sqlite);
    const scope={userId:ALICE.id};
    const validFetch=vi.fn(async()=>new Response(JSON.stringify({
      user:{id:7},
      courses:[],
    }),{status:200,headers:{"content-type":"application/json"}}));
    const invalidFetch=vi.fn(async()=>new Response("",{status:401}));

    const connected=await connectEd(
      db,scope,keyring,"old-valid-token",validFetch as typeof fetch,
      new Date("2026-10-06T00:00:00.000Z"),
    );
    await expect(connectEd(
      db,scope,keyring,"new-invalid-token",invalidFetch as typeof fetch,
      new Date("2026-10-06T00:01:00.000Z"),
    )).rejects.toMatchObject({code:"ED_AUTH_INVALID"});

    const credentials=new D1SourceCredentialRepository(db,scope,keyring);
    await expect(credentials.getEdApiToken(connected.connection.id)).resolves.toBe("old-valid-token");
    const stored=sqlite.prepare(
      "SELECT ed_api_token_envelope FROM source_credentials WHERE user_id=? AND source_connection_id=?",
    ).get(ALICE.id,connected.connection.id) as {ed_api_token_envelope:string};
    expect(stored.ed_api_token_envelope).not.toContain("old-valid-token");
    expect(stored.ed_api_token_envelope).not.toContain("new-invalid-token");
    close();
  });

  it("syncs Ed only inside the authenticated tenant",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedUsers(sqlite);
    const alice={userId:ALICE.id};
    const bob={userId:BOB.id};
    const accountFetch=vi.fn(async()=>new Response(JSON.stringify({
      user:{id:7},
      courses:[{
        course:{id:123,code:"CSE 331",name:"Software Design",year:"2026",session:"Autumn"},
        role:{role:"student"},
      }],
    }),{status:200,headers:{"content-type":"application/json"}}));

    const connected=await connectEd(
      db,alice,keyring,"alice-ed-token",accountFetch as typeof fetch,
      new Date("2026-10-06T04:00:00.000Z"),
    );
    await new D1SourceCourseRepository(db,alice)
      .setEnabled(connected.connection.id,["123"]);

    const lessonsFetch=vi.fn(async()=>new Response(JSON.stringify({
      modules:[],
      lessons:[{
        id:10,
        course_id:123,
        title:"Tenant lesson",
        status:"completed",
        is_hidden:false,
        is_unlisted:false,
        effective_due_at:"2026-10-10T10:00:00Z",
      }],
    }),{status:200,headers:{"content-type":"application/json"}}));

    await expect(syncEdConnection(
      db,bob,keyring,{fetchImpl:lessonsFetch as typeof fetch},
    )).rejects.toMatchObject({code:"ED_NOT_CONNECTED"});
    expect(lessonsFetch).not.toHaveBeenCalled();

    await expect(syncEdConnection(
      db,alice,keyring,{
        fetchImpl:lessonsFetch as typeof fetch,
        now:new Date("2026-10-06T04:05:00.000Z"),
      },
    )).resolves.toMatchObject({
      insertedCount:1,
      failedCourseCount:0,
      statusUpdatedCount:1,
    });
    await expect(new D1AssignmentRepository(db,bob).list({source:"ed"}))
      .resolves.toEqual([]);
    await expect(new D1AssignmentRepository(db,alice).list({source:"ed"}))
      .resolves.toMatchObject([{title:"Tenant lesson"}]);
    close();
  });

  it("binds Gradescope discovery request completion to the authenticated user",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedUsers(sqlite);
    const started=await startGradescopeDiscovery(
      db,{userId:ALICE.id},new Date("2026-10-06T05:00:00.000Z"),
    );
    const payload={
      protocolVersion:1 as const,
      requestId:started.requestId,
      courses:[],
      errorCode:null,
    };

    await expect(completeGradescopeDiscovery(
      db,{userId:BOB.id},payload,new Date("2026-10-06T05:01:00.000Z"),
    )).rejects.toMatchObject({code:"SYNC_REQUEST_NOT_FOUND"});

    await expect(completeGradescopeDiscovery(
      db,{userId:ALICE.id},payload,new Date("2026-10-06T05:01:00.000Z"),
    )).resolves.toMatchObject({connection:{kind:"gradescope"}});
    close();
  });
  it("binds Gradescope assignment sync requests to the authenticated user",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedUsers(sqlite);
    const alice={userId:ALICE.id};
    const connection=await new D1SourceConnectionRepository(db,alice)
      .upsertGradescope("Gradescope");
    const courses=new D1SourceCourseRepository(db,alice);
    await courses.upsertDiscovered(connection.id,[{
      externalCourseId:"123",
      shortName:"CSE 331",
      fullName:"Software Design",
      term:"Autumn",
      year:"2026",
    }],"2026-10-06T05:00:00.000Z");
    await courses.setEnabled(connection.id,["123"]);

    const started=await startGradescopeSync(
      db,alice,new Date("2026-10-06T05:01:00.000Z"),
    );
    const input={
      requestId:started.requestId,
      batches:[{
        protocolVersion:1 as const,
        requestId:started.requestId,
        courses:[{
          courseId:"123",
          checkedAt:"2026-10-06T05:02:00.000Z",
          assignments:[],
          errorCode:null,
          parseDiagnosticCounts:[],
        }],
        errorCode:null,
      }],
    };

    await expect(completeGradescopeSync(
      db,{userId:BOB.id},input,new Date("2026-10-06T05:02:00.000Z"),
    )).rejects.toMatchObject({code:"SYNC_REQUEST_NOT_FOUND"});

    await expect(completeGradescopeSync(
      db,alice,input,new Date("2026-10-06T05:02:00.000Z"),
    )).resolves.toMatchObject({failedCourseCount:0,lastErrorCode:null});
    close();
  });

  it("binds Canvas submission-status requests to the authenticated user",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    await seedUsers(sqlite);
    const alice={userId:ALICE.id};
    const connection=await new D1SourceConnectionRepository(db,alice)
      .upsertCanvas("Canvas");
    await new D1AssignmentRepository(db,alice).upsertMany(connection.id,[{
      source:"canvas",
      externalId:"canvas-4242",
      courseId:"999",
      courseName:"CSE 999",
      title:"Homework",
      releaseAt:null,
      dueAt:null,
      lateDueAt:null,
      status:"unknown",
      sourceStatusText:null,
      gradeScore:null,
      gradeMax:null,
      gradeDisplay:null,
      sourceUrl:"https://canvas.uw.edu/courses/999/assignments/4242",
      sourceUpdatedAt:null,
    }],"2026-10-06T05:00:00.000Z");

    const started=await startCanvasSubmissionStatusSync(
      db,alice,new Date("2026-10-06T05:01:00.000Z"),
    );
    expect(started.assignments).toHaveLength(1);
    const result={
      ...started.assignments[0]!,
      state:"submitted" as const,
      isLate:false,
      isMissing:false,
      submittedAt:null,
      checkedAt:"2026-10-06T05:02:00.000Z",
      extractorVersion:"canvas-html-v1",
    };
    const input={requestId:started.requestId,results:[result]};

    await expect(completeCanvasSubmissionStatusSync(
      db,{userId:BOB.id},input,new Date("2026-10-06T05:02:00.000Z"),
    )).rejects.toMatchObject({code:"SYNC_REQUEST_NOT_FOUND"});

    await expect(completeCanvasSubmissionStatusSync(
      db,alice,input,new Date("2026-10-06T05:02:00.000Z"),
    )).resolves.toMatchObject({updatedCount:1,failedCount:0});
    close();
  });
});
