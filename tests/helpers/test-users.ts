import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type TestUser={
  id:string;
  name:string;
  email:string;
};

export const ALICE:TestUser={
  id:"alice",
  name:"Alice",
  email:"alice@example.invalid",
};

export const BOB:TestUser={
  id:"bob",
  name:"Bob",
  email:"bob@example.invalid",
};

export function sessionFor(user:TestUser){
  return {
    user:{
      id:user.id,
      name:user.name,
      email:user.email,
      image:null,
    },
    expires:"2099-01-01T00:00:00.000Z",
  };
}

export function openTenantTestDatabase(){
  const db=new Database(":memory:");
  db.pragma("foreign_keys = ON");

  for(const migration of [
    "migrations/0001_auth.sql",
    "migrations/0002_kairos_tenant_schema.sql",
  ]){
    db.exec(fs.readFileSync(path.join(process.cwd(),migration),"utf8"));
  }

  return db;
}
