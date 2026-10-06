import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {
  consumeOAuthRequest,
  registerOAuthRequest,
  resetOAuthRequestRegistryForTests,
} from "@/lib/calendar/oauth-registry";
import {getLocalOAuthRedirectUri} from "@/lib/calendar/local-oauth-origin";
import {D1OAuthRequestRepository} from "@/lib/db/d1/repositories/oauth-requests";
import type {CredentialKeyring} from "@/lib/security/credential-cipher";
import {ALICE,BOB} from "../helpers/test-users";
import {openD1TestDatabase} from "../helpers/d1-test-db";

function challenge(verifier:string){
  return createHash("sha256").update(verifier).digest("base64url");
}

beforeEach(()=>resetOAuthRequestRegistryForTests());

describe("calendar oauth request registry",()=>{
  it("uses S256 PKCE and keeps the verifier server-side",()=>{
    const created=registerOAuthRequest({
      provider:"google",
      redirectUri:"http://127.0.0.1:3000/api/calendars/google/callback",
      returnTo:"/sources",
    },new Date("2026-10-06T00:00:00.000Z"));
    expect(created.state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(created.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    const stored=consumeOAuthRequest(created.state,"google",new Date("2026-10-06T00:05:00.000Z"))!;
    expect(created.codeChallenge).toBe(challenge(stored.codeVerifier));
    expect(created.codeChallenge).not.toContain(stored.codeVerifier);
  });

  it("survives server module re-evaluation within the same process",async()=>{
    const first=await import("@/lib/calendar/oauth-registry");
    const created=first.registerOAuthRequest({
      provider:"microsoft",
      redirectUri:"http://localhost:3000/api/calendars/microsoft/callback",
    },new Date("2026-10-06T00:00:00.000Z"));

    vi.resetModules();
    const reloaded=await import("@/lib/calendar/oauth-registry");
    expect(reloaded.consumeOAuthRequest(
      created.state,
      "microsoft",
      new Date("2026-10-06T00:01:00.000Z"),
    )).not.toBeNull();
    reloaded.resetOAuthRequestRegistryForTests();
  });

  it("is one-time, provider-bound, and expires after about ten minutes",()=>{
    const replay=registerOAuthRequest({
      provider:"microsoft",
      redirectUri:"http://localhost:3000/api/calendars/microsoft/callback",
    },new Date("2026-10-06T00:00:00.000Z"));
    expect(consumeOAuthRequest(replay.state,"google",new Date("2026-10-06T00:01:00.000Z"))).toBeNull();
    expect(consumeOAuthRequest(replay.state,"microsoft",new Date("2026-10-06T00:02:00.000Z"))).not.toBeNull();
    expect(consumeOAuthRequest(replay.state,"microsoft",new Date("2026-10-06T00:03:00.000Z"))).toBeNull();

    const expired=registerOAuthRequest({
      provider:"google",
      redirectUri:"http://127.0.0.1:3000/api/calendars/google/callback",
    },new Date("2026-10-06T00:00:00.000Z"));
    expect(consumeOAuthRequest(expired.state,"google",new Date("2026-10-06T00:10:01.000Z"))).toBeNull();
  });
});

describe("local oauth redirect origins",()=>{
  it("accepts only HTTP localhost and 127.0.0.1",()=>{
    expect(getLocalOAuthRedirectUri(
      "http://127.0.0.1:3000/api/calendars/google/start",
      "/api/calendars/google/callback",
    )).toBe("http://127.0.0.1:3000/api/calendars/google/callback");
    expect(getLocalOAuthRedirectUri(
      "http://localhost:3000/api/calendars/microsoft/start",
      "/api/calendars/microsoft/callback",
    )).toBe("http://localhost:3000/api/calendars/microsoft/callback");

    for(const unsafe of [
      "https://evil.example/api/calendars/google/start",
      "http://localhost.evil.example:3000/api/calendars/google/start",
      "http://user:pass@localhost:3000/api/calendars/google/start",
      "https://localhost:3000/api/calendars/google/start",
    ]){
      expect(()=>getLocalOAuthRedirectUri(unsafe,"/api/calendars/google/callback")).toThrow();
    }
  });
});


const hostedKeyring:CredentialKeyring={
  activeKeyId:"k1",
  keys:{k1:new Uint8Array(32).fill(21)},
};

function seedHostedUsers(sqlite:ReturnType<typeof openD1TestDatabase>["sqlite"]){
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)")
    .run(ALICE.id,ALICE.name,ALICE.email);
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES (?,?,?)")
    .run(BOB.id,BOB.name,BOB.email);
}

describe("hosted calendar oauth request registry",()=>{
  it("persists only a state hash and encrypted PKCE verifier across repository instances",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    seedHostedUsers(sqlite);
    const created=await new D1OAuthRequestRepository(db,{userId:ALICE.id},hostedKeyring)
      .register({
        provider:"google",
        redirectUri:"https://mykairos.me/api/calendars/google/callback",
        returnTo:"/sources",
      },new Date("2026-10-06T00:00:00.000Z"));

    const stored=sqlite.prepare(`
      SELECT state_hash,code_verifier_envelope
      FROM oauth_requests WHERE user_id=?
    `).get(ALICE.id) as {state_hash:string;code_verifier_envelope:string};

    expect(stored.state_hash).not.toBe(created.state);
    expect(stored.state_hash).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(stored.code_verifier_envelope).toMatch(/^v1\./);

    const consumed=await new D1OAuthRequestRepository(db,{userId:ALICE.id},hostedKeyring)
      .consume(created.state,"google",new Date("2026-10-06T00:01:00.000Z"));
    expect(consumed).not.toBeNull();
    expect(created.codeChallenge).toBe(challenge(consumed!.codeVerifier));
    expect(stored.code_verifier_envelope).not.toContain(consumed!.codeVerifier);
    close();
  });

  it("is user-bound, provider-bound, expiring, and atomically one-time",async()=>{
    const {db,sqlite,close}=openD1TestDatabase();
    seedHostedUsers(sqlite);
    const alice=new D1OAuthRequestRepository(db,{userId:ALICE.id},hostedKeyring);
    const bob=new D1OAuthRequestRepository(db,{userId:BOB.id},hostedKeyring);

    const isolated=await alice.register({
      provider:"microsoft",
      redirectUri:"https://mykairos.me/api/calendars/microsoft/callback",
    },new Date("2026-10-06T00:00:00.000Z"));
    await expect(bob.consume(isolated.state,"microsoft",new Date("2026-10-06T00:01:00.000Z")))
      .resolves.toBeNull();
    await expect(alice.consume(isolated.state,"google",new Date("2026-10-06T00:01:00.000Z")))
      .resolves.toBeNull();

    const [first,second]=await Promise.all([
      alice.consume(isolated.state,"microsoft",new Date("2026-10-06T00:02:00.000Z")),
      alice.consume(isolated.state,"microsoft",new Date("2026-10-06T00:02:00.000Z")),
    ]);
    expect([first,second].filter(Boolean)).toHaveLength(1);

    const expired=await alice.register({
      provider:"google",
      redirectUri:"https://mykairos.me/api/calendars/google/callback",
    },new Date("2026-10-06T00:00:00.000Z"));
    await expect(alice.consume(expired.state,"google",new Date("2026-10-06T00:10:01.000Z")))
      .resolves.toBeNull();
    close();
  });

  it.each([
    "https://evil.example/path",
    "//evil.example/path",
    "\\\\evil.example/path",
    "javascript:alert(1)",
  ])("rejects unsafe return target %s",async(returnTo)=>{
    const {db,sqlite,close}=openD1TestDatabase();
    seedHostedUsers(sqlite);
    const repo=new D1OAuthRequestRepository(db,{userId:ALICE.id},hostedKeyring);
    await expect(repo.register({
      provider:"google",
      redirectUri:"https://mykairos.me/api/calendars/google/callback",
      returnTo,
    })).rejects.toThrow(/return/i);
    close();
  });
});
