import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1ResultLike,
} from "@/lib/db/d1/types";

class TestD1Statement implements D1PreparedStatementLike{
  constructor(
    private readonly sqlite:Database.Database,
    private readonly sql:string,
    private readonly params:unknown[]=[],
  ){}

  bind(...values:unknown[]):D1PreparedStatementLike{
    return new TestD1Statement(this.sqlite,this.sql,values);
  }

  async first<T=Record<string,unknown>>():Promise<T|null>{
    return (this.sqlite.prepare(this.sql).get(...this.params) as T|undefined)??null;
  }

  async all<T=Record<string,unknown>>():Promise<D1ResultLike<T>>{
    return {
      success:true,
      results:this.sqlite.prepare(this.sql).all(...this.params) as T[],
      meta:{changes:0},
    };
  }

  async run<T=Record<string,unknown>>():Promise<D1ResultLike<T>>{
    const result=this.sqlite.prepare(this.sql).run(...this.params);
    return {
      success:true,
      results:[],
      meta:{changes:result.changes},
    };
  }
}

class TestD1Database implements D1DatabaseLike{
  constructor(readonly sqlite:Database.Database){}

  prepare(sql:string):D1PreparedStatementLike{
    return new TestD1Statement(this.sqlite,sql);
  }

  async batch(statements:D1PreparedStatementLike[]):Promise<D1ResultLike[]>{
    const out:D1ResultLike[]=[];
    for(const statement of statements) out.push(await statement.run());
    return out;
  }

  async exec(sql:string):Promise<void>{
    this.sqlite.exec(sql);
  }
}

export function openD1TestDatabase(){
  const sqlite=new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for(const migration of ["migrations/0001_auth.sql","migrations/0002_kairos_tenant_schema.sql"]){
    sqlite.exec(fs.readFileSync(path.join(process.cwd(),migration),"utf8"));
  }
  return {
    db:new TestD1Database(sqlite) as D1DatabaseLike,
    sqlite,
    close:()=>sqlite.close(),
  };
}
