import "server-only";
import {normalizeSourceAssignment} from "@/lib/assignments/normalize";
import {BoundedBodyError,readBoundedUtf8} from "@/lib/http/bounded-body";
import {CanvasSourceError} from "@/lib/sources/canvas-ical/errors";
import {parseCanvasIcal} from "@/lib/sources/canvas-ical/parser";
import {fetchCanvasFeedResponse} from "@/lib/sources/canvas-ical/transport";
import {CanvasFeedUrlError,validateCanvasFeedUrl} from "@/lib/sources/canvas-ical/validate-url";
import {GUEST_MAX_UPSTREAM_BYTES,GUEST_CANVAS_MAX_EVENT_BLOCKS,GUEST_CANVAS_MAX_ASSIGNMENTS,GUEST_CANVAS_MAX_OUTPUT_BYTES,guestJsonBytes} from "../limits";
import {isGuestSourceUrl} from "../schema";
import {guestCanvasFeedRequestSchema,guestCanvasFeedResponseSchema,type GuestCanvasFeedRequest,type GuestCanvasFeedResponse} from "./contracts";
import {type GuestSourceContext,withGuestSourceDeadline} from "./deadline";
import {GuestSourceError} from "./errors";

export async function readGuestCanvas(input:GuestCanvasFeedRequest,context:GuestSourceContext):Promise<GuestCanvasFeedResponse>{
  return withGuestSourceDeadline(context,"NETWORK_ERROR",async scope=>{
    try{
      const request=guestCanvasFeedRequestSchema.safeParse(input);
      if(!request.success||input.requestId!==context.requestId)throw new GuestSourceError("BAD_REQUEST");
      const response=await fetchCanvasFeedResponse(validateCanvasFeedUrl(input.feedUrl),scope.fetchImpl,scope.signal);
      if(!response.ok){try{void response.body?.cancel().catch(()=>{});}catch{/* Best effort only. */}}
      if(response.status===401||response.status===403)throw new GuestSourceError("UNAUTHORIZED_OR_EXPIRED_FEED");
      if(!response.ok)throw new GuestSourceError("NETWORK_ERROR");
      const body=await readBoundedUtf8(response.body,{maxBytes:GUEST_MAX_UPSTREAM_BYTES,signal:scope.signal});
      scope.check();
      let eventCount=0;const eventStart=/BEGIN:VEVENT/gi;
      while(eventStart.exec(body)!==null){
        if(++eventCount>GUEST_CANVAS_MAX_EVENT_BLOCKS)throw new GuestSourceError("SOURCE_RESULT_TOO_LARGE");
      }
      scope.check();
      const parsed=parseCanvasIcal(body);
      scope.check();
      if(parsed.assignments.length>GUEST_CANVAS_MAX_ASSIGNMENTS)throw new GuestSourceError("SOURCE_RESULT_TOO_LARGE");
      if(parsed.assignments.length===0&&parsed.errors.length>0)throw new GuestSourceError("INVALID_ICAL");
      const assignments=parsed.assignments.map(row=>{
        const normalized=normalizeSourceAssignment("canvas",row);
        return {...normalized,source:"canvas" as const,sourceUrl:isGuestSourceUrl(normalized.sourceUrl,"canvas",normalized.courseId)?normalized.sourceUrl:null};
      });
      const result={ok:true as const,schemaVersion:1 as const,requestId:context.requestId,checkedAt:context.checkedAt,assignments,
        report:{skippedCount:parsed.skipped,malformedCount:parsed.errors.length,partial:parsed.errors.length>0}};
      scope.check();
      if(guestJsonBytes(result)>GUEST_CANVAS_MAX_OUTPUT_BYTES)throw new GuestSourceError("SOURCE_RESULT_TOO_LARGE");
      const validated=guestCanvasFeedResponseSchema.safeParse(result);
      scope.check();
      if(!validated.success)throw new GuestSourceError("INVALID_ICAL");
      await scope.assertProviderCurrent();
      return validated.data;
    }catch(error){
      scope.check();
      if(error instanceof GuestSourceError)throw error;
      if(error instanceof CanvasFeedUrlError)throw new GuestSourceError("INVALID_FEED_URL");
      if(error instanceof CanvasSourceError)throw new GuestSourceError(error.code);
      if(error instanceof BoundedBodyError){
        if(error.code==="BODY_TOO_LARGE")throw new GuestSourceError("SOURCE_RESULT_TOO_LARGE");
        if(error.code==="INVALID_UTF8")throw new GuestSourceError("INVALID_ICAL");
      }
      throw new GuestSourceError("NETWORK_ERROR");
    }
  });
}
