export type LegacyRunResult={
  changes:number;
  lastInsertRowid?:number|bigint;
};

export interface LegacyStatement{
  get(...params:unknown[]):unknown;
  all(...params:unknown[]):unknown[];
  run(...params:unknown[]):LegacyRunResult;
}

export interface LegacyDatabase{
  prepare(sql:string):LegacyStatement;
  transaction<T extends (...args:never[])=>unknown>(fn:T):T;
  exec(sql:string):unknown;
}
