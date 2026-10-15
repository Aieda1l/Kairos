import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root=process.cwd();

function migration(name:string):string{
  const file=path.join(root,"migrations",name);
  expect(fs.existsSync(file), `${name} should exist`).toBe(true);
  return fs.readFileSync(file,"utf8").replace(/\s+/g," ").trim();
}

describe("D1 hosted schema contract",()=>{
  it("creates the four Auth.js D1 adapter tables",()=>{
    const sql=migration("0001_auth.sql");
    for(const table of ["users","accounts","sessions","verification_tokens"]){
      expect(sql).toMatch(new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ["\\[]?${table}["\\]]?`, "i"));
    }
  });

  it("scopes source connections and assignments with composite tenant keys",()=>{
    const sql=migration("0002_kairos_tenant_schema.sql");
    expect(sql).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? source_connections/i);
    expect(sql).toMatch(/PRIMARY KEY\s*\(\s*user_id\s*,\s*id\s*\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*user_id\s*,\s*kind\s*\)/i);
    expect(sql).toMatch(/FOREIGN KEY\s*\(\s*user_id\s*,\s*source_connection_id\s*\)\s*REFERENCES\s+source_connections\s*\(\s*user_id\s*,\s*id\s*\)/i);
  });

  it("scopes calendar, settings, and durable request state to a user",()=>{
    const sql=migration("0002_kairos_tenant_schema.sql");
    for(const table of ["calendar_connections","calendar_event_links","app_settings","sync_requests","oauth_requests"]){
      const tableBlock=new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${table} \\((.*?)\\);`, "i").exec(sql)?.[1];
      expect(tableBlock, `${table} should exist`).toBeTruthy();
      expect(tableBlock).toMatch(/\buser_id\b/i);
    }
    expect(sql).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? app_settings\s*\([^;]*PRIMARY KEY\s*\(\s*user_id\s*,\s*key\s*\)/i);
  });

  it("stores protected values only in versioned envelope columns",()=>{
    const sql=migration("0002_kairos_tenant_schema.sql");
    for(const column of [
      "canvas_feed_url_envelope",
      "ed_api_token_envelope",
      "oauth_refresh_token_envelope",
      "caldav_username",
      "caldav_secret_envelope",
      "code_verifier_envelope",
    ]){
      expect(sql).toContain(column);
    }
    expect(sql).not.toMatch(/\bcanvas_feed_url\s+TEXT\b/i);
    expect(sql).not.toMatch(/\bed_api_token\s+TEXT\b/i);
    expect(sql).not.toMatch(/\boauth_refresh_token\s+TEXT\b/i);
    expect(sql).not.toMatch(/\bcaldav_secret\s+TEXT\b/i);
  });

  it("pins durable sync and OAuth request identities",()=>{
    const sql=migration("0002_kairos_tenant_schema.sql");
    expect(sql).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? sync_requests\s*\([^;]*request_id[^;]*kind[^;]*payload_json[^;]*created_at[^;]*expires_at[^;]*consumed_at[^;]*PRIMARY KEY\s*\(\s*user_id\s*,\s*request_id\s*\)/i);
    expect(sql).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? oauth_requests\s*\([^;]*state_hash[^;]*provider[^;]*code_verifier_envelope[^;]*connection_id[^;]*return_to[^;]*redirect_uri[^;]*created_at[^;]*expires_at[^;]*consumed_at[^;]*PRIMARY KEY\s*\(\s*user_id\s*,\s*state_hash\s*\)/i);
  });
});
