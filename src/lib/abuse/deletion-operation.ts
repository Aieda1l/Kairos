import "server-only";
import {AsyncLocalStorage} from "node:async_hooks";
import type {UserScope} from "@/lib/auth/user-scope";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {enforceBudget} from "./guard";
import {providerRuntime} from "./provider-operation";

type Attempt={db:D1DatabaseLike;userId:string;active:boolean};
const storage=new AsyncLocalStorage<Attempt>();

/** Authentication precedes this boundary. Invalid confirmations consume too;
 * the common local deletion service reuses only this live server-issued scope. */
export async function withDeletionAttempt<T>(db:D1DatabaseLike,scope:UserScope,work:()=>Promise<T>):Promise<T>{
  const parent=storage.getStore();
  if(parent?.active&&parent.db===db&&parent.userId===scope.userId)return work();
  await enforceBudget(await providerRuntime(db),{class:"deletion",userId:scope.userId});
  const attempt={db,userId:scope.userId,active:true};
  return storage.run(attempt,async()=>{try{return await work();}finally{attempt.active=false;}});
}
