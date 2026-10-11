import type { AssignmentSource, ConnectionResult, SourceAssignment, SourceKind } from "@/lib/sources/types";
import { fetchCanvasFeed } from "./fetch-feed";
import { parseCanvasIcal } from "./parser";
import { CanvasSourceError } from "./errors";
import {CanvasFeedUrlError} from "./validate-url";
import {getCanvasRouteFetch} from "./e2e-fixture-fetch";
export class CanvasIcalSource implements AssignmentSource {
 readonly kind:SourceKind="canvas"; private report={skipped:0,errors:[] as string[]};
 constructor(private readonly feedUrl:URL, private readonly fetchImpl:typeof fetch=getCanvasRouteFetch()) {}
 async testConnection():Promise<ConnectionResult>{try{const body=await fetchCanvasFeed(this.feedUrl,this.fetchImpl);const parsed=parseCanvasIcal(body);this.report={skipped:parsed.skipped,errors:parsed.errors};return {ok:true,itemCount:parsed.assignments.length};}catch(error){if(error instanceof CanvasSourceError||error instanceof CanvasFeedUrlError)return {ok:false,code:error.code,message:error.message};return {ok:false,code:"INVALID_ICAL",message:"Canvas returned a calendar feed that could not be read."};}}
 async sync():Promise<SourceAssignment[]>{const body=await fetchCanvasFeed(this.feedUrl,this.fetchImpl);const parsed=parseCanvasIcal(body);this.report={skipped:parsed.skipped,errors:parsed.errors};return parsed.assignments;}
 getLastParseReport(){return {skipped:this.report.skipped,errors:[...this.report.errors]};}
}
