import {z} from "zod";
import {D1SourceConnectionRepository} from "@/lib/db/d1/repositories/source-connections";
import {D1SourceCredentialRepository} from "@/lib/db/d1/repositories/source-credentials";
import {SourceConnectionRepository} from "@/lib/db/repositories/source-connections";
import {SourceCredentialRepository} from "@/lib/db/repositories/source-credentials";
import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";
import {validateCanvasFeedUrl,CanvasFeedUrlError} from "@/lib/sources/canvas-ical/validate-url";
import {CanvasIcalSource} from "@/lib/sources/canvas-ical/source";
import {CanvasSourceError} from "@/lib/sources/canvas-ical/errors";
import {syncCanvasConnection} from "@/lib/sync/sync-source";
import {SyncServiceError} from "@/lib/sync/types";

const schema=z.object({
  feedUrl:z.string().min(1),
  label:z.string().trim().min(1).max(80).optional(),
});

export async function POST(request:Request){
  let body:unknown;
  try{body=await request.json();}
  catch{
    return Response.json(
      {code:"INVALID_REQUEST",message:"Enter a Canvas calendar feed URL."},
      {status:400},
    );
  }
  const parsed=schema.safeParse(body);
  if(!parsed.success){
    return Response.json(
      {code:"INVALID_REQUEST",message:"Enter a Canvas calendar feed URL."},
      {status:400},
    );
  }

  try{
    const url=validateCanvasFeedUrl(parsed.data.feedUrl,{
      allowLoopbackHttp:process.env.E2E_FIXTURES==="1",
    });
    const resolved=await resolveSourceApiRuntime();
    if(!resolved.ok)return resolved.response;
    const runtime=resolved.runtime;

    const probe=await new CanvasIcalSource(url).testConnection();
    if(!probe.ok){
      return Response.json(
        {code:probe.code,message:probe.message},
        {status:probe.code==="UNAUTHORIZED_OR_EXPIRED_FEED"?401:422},
      );
    }

    if(runtime.kind==="legacy"){
      const connection=new SourceConnectionRepository(runtime.db)
        .upsertCanvas(parsed.data.label??"Canvas");
      new SourceCredentialRepository(runtime.db)
        .setCanvasFeedUrl(connection.id,url.toString());
      const sync=await syncCanvasConnection(connection.id,{
        db:runtime.db,
        sourceFactory:stored=>new CanvasIcalSource(stored),
      });
      const publicConnection=new SourceConnectionRepository(runtime.db)
        .getByKind("canvas")!;
      return Response.json({connection:publicConnection,sync});
    }

    const connections=new D1SourceConnectionRepository(runtime.db,runtime.scope);
    const connection=await connections.upsertCanvas(parsed.data.label??"Canvas");
    await new D1SourceCredentialRepository(
      runtime.db,runtime.scope,runtime.keyring,
    ).setCanvasFeedUrl(connection.id,url.toString());
    const sync=await syncCanvasConnection(connection.id,{
      db:runtime.db,
      scope:runtime.scope,
      keyring:runtime.keyring,
      sourceFactory:stored=>new CanvasIcalSource(stored),
    });
    return Response.json({
      connection:await connections.getByKind("canvas"),
      sync,
    });
  }catch(error){
    if(error instanceof CanvasFeedUrlError){
      return Response.json({code:error.code,message:error.message},{status:400});
    }
    if(error instanceof SyncServiceError||error instanceof CanvasSourceError){
      return Response.json({code:error.code,message:error.message},{status:502});
    }
    return Response.json(
      {code:"CONNECT_FAILED",message:"Canvas could not be connected. Try again."},
      {status:502},
    );
  }
}
