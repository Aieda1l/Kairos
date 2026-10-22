export type D1ResultLike<T=Record<string,unknown>>={
  success:boolean;
  results:T[];
  meta:{changes?:number;[key:string]:unknown};
};

export interface D1PreparedStatementLike{
  bind(...values:unknown[]):D1PreparedStatementLike;
  first<T=Record<string,unknown>>():Promise<T|null>;
  all<T=Record<string,unknown>>():Promise<D1ResultLike<T>>;
  run<T=Record<string,unknown>>():Promise<D1ResultLike<T>>;
}

/** Keep each batched read paired with its repository's normal decoding. */
export type D1Read<T>={
  statement:D1PreparedStatementLike;
  read:(result:D1ResultLike)=>T;
};

export interface D1DatabaseLike{
  prepare(sql:string):D1PreparedStatementLike;
  batch(statements:D1PreparedStatementLike[]):Promise<D1ResultLike[]>;
  exec(sql:string):Promise<unknown>;
}
