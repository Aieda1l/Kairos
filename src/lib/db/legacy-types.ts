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
  transaction<Args extends unknown[],Result>(
    fn:(...args:Args)=>Result,
  ):(...args:Args)=>Result;
  exec(sql:string):unknown;
}
