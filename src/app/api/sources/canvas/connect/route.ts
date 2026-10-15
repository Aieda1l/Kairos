import {abuseErrorResponse} from "@/lib/abuse/guard";
import {resolveSourceApiRuntime} from "@/lib/platform/source-api-runtime";
import {CanvasFeedUrlError} from "@/lib/sources/canvas-ical/validate-url";
import {canvasConnectSchema,connectCanvas} from "@/lib/sources/canvas-ical/connection-service";
import {CanvasSourceError} from "@/lib/sources/canvas-ical/errors";
import {SyncServiceError} from "@/lib/sync/types";

export async function POST(request:Request){
  let body:unknown;
  try{body=await request.json();}
  catch{
    return Response.json(
      {code:"INVALID_REQUEST",message:"Enter a Canvas calendar feed URL."},
      {status:400},
    );
  }
  const parsed=canvasConnectSchema.safeParse(body);
  if(!parsed.success){
    return Response.json(
      {code:"INVALID_REQUEST",message:"Enter a Canvas calendar feed URL."},
      {status:400},
    );
  }

  try{
    const resolved=await resolveSourceApiRuntime();
    if(!resolved.ok)return resolved.response;
    return Response.json(await connectCanvas(resolved.runtime,parsed.data));
  }catch(error){
    const ownership=abuseErrorResponse(error);if(ownership)return ownership;
    if(error instanceof CanvasFeedUrlError){
      return Response.json({code:error.code,message:error.message},{status:400});
    }
    if(error instanceof CanvasSourceError){
      return Response.json({code:error.code,message:error.message},{
        status:error.code==="UNAUTHORIZED_OR_EXPIRED_FEED"?401:422,
      });
    }
    if(error instanceof SyncServiceError){
      return Response.json({code:error.code,message:error.message},{status:502});
    }
    return Response.json(
      {code:"CONNECT_FAILED",message:"Canvas could not be connected. Try again."},
      {status:502},
    );
  }
}
