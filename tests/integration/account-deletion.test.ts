import {beforeEach,describe,expect,it,vi} from "vitest";
import {openD1TestDatabase} from "../helpers/d1-test-db";
import {ALICE,BOB} from "../helpers/test-users";

const runtime=vi.hoisted(()=>({resolve:vi.fn()}));
vi.mock("@/lib/platform/source-api-runtime",()=>({
  resolveSourceApiRuntime:runtime.resolve,
}));

function seedUser(sqlite:ReturnType<typeof openD1TestDatabase>["sqlite"],id:string,name:string,email:string){
  const now="2026-10-07T00:00:00.000Z";
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)").run(id,name,email);
  sqlite.prepare(`
    INSERT INTO accounts(id,userId,type,provider,providerAccountId)
    VALUES (?,?,?,?,?)
  `).run(`account-${id}`,id,"oauth","google",`provider-${id}`);
  sqlite.prepare(`
    INSERT INTO sessions(id,sessionToken,userId,expires)
    VALUES (?,?,?,?)
  `).run(`session-${id}`,`token-${id}`,id,"2099-01-01T00:00:00.000Z");
  sqlite.prepare(`
    INSERT INTO source_connections(user_id,id,kind,label,created_at,updated_at)
    VALUES (?,?,?,?,?,?)
  `).run(id,`source-${id}`,"canvas","Canvas",now,now);
  sqlite.prepare(`
    INSERT INTO assignments(
      user_id,id,source_connection_id,source_kind,external_id,course_name,title,status,
      first_seen_at,last_seen_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id,`assignment-${id}`,`source-${id}`,"canvas",`external-${id}`,
    "CSE 000",`Assignment ${id}`,"pending",now,now,now,now,
  );
  sqlite.prepare(`
    INSERT INTO calendar_connections(user_id,id,provider,label,created_at,updated_at)
    VALUES (?,?,?,?,?,?)
  `).run(id,`calendar-${id}`,"google","Google Calendar",now,now);
  sqlite.prepare(`
    INSERT INTO app_settings(user_id,key,value,updated_at) VALUES (?,?,?,?)
  `).run(id,"timezone","America/Los_Angeles",now);
  sqlite.prepare(`
    INSERT INTO sync_requests(user_id,request_id,kind,payload_json,created_at,expires_at)
    VALUES (?,?,?,?,?,?)
  `).run(id,`request-${id}`,"gradescope","{}",now,"2026-10-07T00:10:00.000Z");
  sqlite.prepare(`
    INSERT INTO oauth_requests(
      user_id,state_hash,provider,code_verifier_envelope,return_to,redirect_uri,created_at,expires_at
    ) VALUES (?,?,?,?,?,?,?,?)
  `).run(
    id,`state-${id}`,"google","encrypted","/sources",
    "https://mykairos.me/api/calendars/google/callback",now,"2026-10-07T00:10:00.000Z",
  );
}

describe("hosted account deletion",()=>{
  beforeEach(()=>{
    runtime.resolve.mockReset();
    vi.restoreAllMocks();
  });

  it("deletes only the current user and relies on database cleanup without remote provider calls",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    seedUser(sqlite,ALICE.id,ALICE.name,ALICE.email);
    seedUser(sqlite,BOB.id,BOB.name,BOB.email);
    const fetchSpy=vi.spyOn(globalThis,"fetch");
    const {deleteCurrentAccount}=await import("@/lib/account/delete-account");

    await deleteCurrentAccount(db,{userId:ALICE.id});

    for(const table of [
      "users","accounts","sessions","source_connections","assignments",
      "calendar_connections","app_settings","sync_requests","oauth_requests",
    ]){
      const ownerColumn=table==="users"
        ?"id"
        :table==="accounts"||table==="sessions"
          ?"userId"
          :"user_id";
      expect(sqlite.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${
        ownerColumn
      }=?`).get(ALICE.id)).toEqual({count:0});
    }
    expect(sqlite.prepare("SELECT COUNT(*) count FROM users WHERE id=?").get(BOB.id)).toEqual({count:1});
    expect(sqlite.prepare("SELECT userId FROM sessions WHERE sessionToken=?").get("token-alice")).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    close();
  });

  it("requires confirmation and rejects a browser-supplied target user id",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    seedUser(sqlite,ALICE.id,ALICE.name,ALICE.email);
    seedUser(sqlite,BOB.id,BOB.name,BOB.email);
    runtime.resolve.mockResolvedValue({
      ok:true,
      runtime:{kind:"hosted",db,scope:{userId:ALICE.id},keyring:{activeKeyId:"v1",keys:{}}},
    });
    const route=await import("@/app/api/account/route");

    const targeted=await route.DELETE(new Request("https://mykairos.me/api/account",{
      method:"DELETE",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({confirmation:"DELETE",userId:BOB.id}),
    }));
    expect(targeted.status).toBe(400);

    const deleted=await route.DELETE(new Request("https://mykairos.me/api/account",{
      method:"DELETE",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({confirmation:"DELETE"}),
    }));
    expect(deleted.status).toBe(204);
    expect(sqlite.prepare("SELECT id FROM users WHERE id=?").get(ALICE.id)).toBeUndefined();
    expect(sqlite.prepare("SELECT id FROM users WHERE id=?").get(BOB.id)).toEqual({id:BOB.id});
    close();
  });
});
