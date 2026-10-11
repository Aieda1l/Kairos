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
    return this.execute() as D1ResultLike<T>;
  }

  execute():D1ResultLike{
    const statement=this.sqlite.prepare(this.sql);
    if(statement.reader){
      return {success:true,results:statement.all(...this.params) as Record<string,unknown>[],meta:{changes:0}};
    }
    const result=statement.run(...this.params);
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
    return this.sqlite.transaction(()=>statements.map(statement=>{
      if(!(statement instanceof TestD1Statement))throw new Error("Expected a test D1 statement.");
      return statement.execute();
    }))();
  }

  async exec(sql:string):Promise<void>{
    this.sqlite.exec(sql);
  }
}

export function openD1TestDatabase(options:{
  beforeMigration?:(name:string,sqlite:Database.Database)=>void;
  filename?:string;
  migrate?:boolean;
}={}){
  const sqlite=new Database(options.filename??":memory:");
  sqlite.pragma("foreign_keys = ON");
  const directory=path.join(process.cwd(),"migrations");
  for(const migration of options.migrate===false?[]:fs.readdirSync(directory).filter(name=>/^\d+.*\.sql$/.test(name)).sort()){
    options.beforeMigration?.(migration,sqlite);
    sqlite.exec(fs.readFileSync(path.join(directory,migration),"utf8"));
  }
  return {
    db:new TestD1Database(sqlite) as D1DatabaseLike,
    sqlite,
    close:()=>sqlite.close(),
  };
}
