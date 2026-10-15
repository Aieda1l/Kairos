import {expect,it} from "vitest";
import {createAuthConfig} from "@/lib/auth/config";
import {openD1TestDatabase} from "../helpers/d1-test-db";
import {readFileSync} from "node:fs";
import {Auth} from "@auth/core";

it("persists the identity account link without unused OAuth credentials",async()=>{
  const {db,sqlite,close}=openD1TestDatabase();
  sqlite.prepare("INSERT INTO users(id,name,email) VALUES ('alice','Alice','alice@example.invalid')").run();
  const config=createAuthConfig(db as never,{
    AUTH_SECRET:"fixture-auth-secret",AUTH_GOOGLE_ID:"fixture-google-id",AUTH_GOOGLE_SECRET:"fixture-google-secret",
    AUTH_MICROSOFT_ENTRA_ID_ID:"fixture-microsoft-id",AUTH_MICROSOFT_ENTRA_ID_SECRET:"fixture-microsoft-secret",
  });
  try{
    await config.adapter!.linkAccount!({
      userId:"alice",type:"oauth",provider:"google",providerAccountId:"fixture-provider-account",
      access_token:"identity-access-never-persist",refresh_token:"identity-refresh-never-persist",
      id_token:"identity-id-never-persist",token_type:"bearer",expires_at:2000000000,
    });
    const account=sqlite.prepare("SELECT userId,provider,providerAccountId,access_token,refresh_token,id_token FROM accounts").get();
    expect(account).toEqual({
      userId:"alice",provider:"google",providerAccountId:"fixture-provider-account",
      access_token:null,refresh_token:null,id_token:null,
    });
    expect(await config.adapter!.getUserByAccount!({provider:"google",providerAccountId:"fixture-provider-account"})).toMatchObject({id:"alice"});
  }finally{close();}
});

it("clears old identity tokens while preserving account links, sessions, and calendar grants",()=>{
  const {sqlite,close}=openD1TestDatabase();
  try{
    sqlite.exec(`
      INSERT INTO users(id,name,email) VALUES ('alice','Alice','alice@example.invalid');
      INSERT INTO accounts(id,userId,type,provider,providerAccountId,access_token,refresh_token,id_token)
      VALUES ('account','alice','oauth','google','provider-account','old-access','old-refresh','old-id');
      INSERT INTO sessions(id,sessionToken,userId,expires) VALUES ('session','fixture-session','alice','2099-01-01');
      INSERT INTO calendar_connections(user_id,id,provider,label,enabled,created_at,updated_at)
      VALUES ('alice','calendar','google','Google',1,'2026-10-10','2026-10-10');
      INSERT INTO calendar_credentials(user_id,calendar_connection_id,oauth_refresh_token_envelope,updated_at)
      VALUES ('alice','calendar','unchanged-calendar-envelope','2026-10-10');
    `);
    sqlite.exec(readFileSync("migrations/0003_identity_token_minimization.sql","utf8"));
    expect(sqlite.prepare("SELECT userId,providerAccountId,access_token,refresh_token,id_token FROM accounts").get()).toEqual({
      userId:"alice",providerAccountId:"provider-account",access_token:null,refresh_token:null,id_token:null,
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM sessions").get()).toEqual({count:1});
    expect(sqlite.prepare("SELECT oauth_refresh_token_envelope FROM calendar_credentials").get()).toEqual({oauth_refresh_token_envelope:"unchanged-calendar-envelope"});
  }finally{close();}
});

it("the Auth.js session response excludes the database session token and internal fields",async()=>{
  const {db,sqlite,close}=openD1TestDatabase();
  try{
    sqlite.prepare("INSERT INTO users(id,name,email) VALUES ('alice','Alice','alice@example.invalid')").run();
    const config=createAuthConfig(db as never,{
      AUTH_SECRET:"fixture-auth-secret",AUTH_GOOGLE_ID:"fixture-google-id",AUTH_GOOGLE_SECRET:"fixture-google-secret",
      AUTH_MICROSOFT_ENTRA_ID_ID:"fixture-ms-id",AUTH_MICROSOFT_ENTRA_ID_SECRET:"fixture-ms-secret",
    });
    const token="fixture-private-session-token-never-echo";
    await config.adapter!.createSession!({userId:"alice",sessionToken:token,expires:new Date("2099-01-01")});
    const response=await Auth(new Request("http://127.0.0.1:3000/api/auth/session",{
      headers:{cookie:`authjs.session-token=${token}`},
    }),{...config,basePath:"/api/auth",trustHost:true});
    expect(response.status).toBe(200);
    const body=await response.text();
    expect(body).not.toContain(token);
    expect(JSON.parse(body)).toMatchObject({user:{id:"alice",name:"Alice",email:"alice@example.invalid"}});
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(["expires","user"]);
  }finally{close();}
});
