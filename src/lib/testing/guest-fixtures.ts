import "server-only";
import type {D1DatabaseLike} from "@/lib/db/d1/types";
import {isLocalFixtureEnvironment} from "./auth-transport";

/** Test-only anonymous history isolation. Never used by guest clear-data or live source endpoints. */
export async function resetLocalGuestAdmission(request:Request):Promise<number|null>{
  let env:Record<string,unknown>;
  try{env=(await import("cloudflare:workers")).env;}catch{return null;}
  const enabled=process.env.E2E_FIXTURES==="1"||env.E2E_FIXTURES==="1";
  // Avoid spreading bindings: even accessing DB must wait until every guard passes.
  if(!enabled||!isLocalFixtureEnvironment({E2E_FIXTURES:"1",KAIROS_LOCAL_AUTH:env.KAIROS_LOCAL_AUTH,KAIROS_ABUSE_TRUSTED_INGRESS:env.KAIROS_ABUSE_TRUSTED_INGRESS,KAIROS_APP_URL:env.KAIROS_APP_URL}))return null;
  const actual=new URL(request.url),canonical=new URL(String(env.KAIROS_APP_URL));
  if(request.method!=="POST"||actual.protocol!=="http:"||!["localhost","127.0.0.1"].includes(actual.hostname)||actual.port!==canonical.port||actual.origin!==canonical.origin||request.headers.get("origin")!==actual.origin)return null;
  for(const name of ["host","x-forwarded-host"]){const value=request.headers.get(name);if(value!==null&&value!==actual.host)return null;}
  const proto=request.headers.get("x-forwarded-proto");
  if(proto!==null&&proto!=="http"||request.headers.has("forwarded"))return null;
  if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")return null;
  const length=request.headers.get("content-length");if(length!==null&&(!/^\d+$/.test(length)||Number(length)>64))return null;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
    reader=request.body?.getReader();if(!reader)return null;
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>64){await reader.cancel();return null;}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const value:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==0)return null;
  }catch{return null;}finally{reader?.releaseLock();}
  const db=env.DB as D1DatabaseLike|undefined;if(!db)return null;
  // Includes disposable anonymous auth-initiation rows; all user-associated rows survive.
  const result=await db.prepare("DELETE FROM abuse_rate_events WHERE user_id IS NULL").run();
  return result.meta.changes??0;
}
