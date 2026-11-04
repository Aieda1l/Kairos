import { EdSourceError } from "./errors";
import {reportSourceRequestFailure} from "@/lib/sources/upstream-diagnostics";
import {fetchEdResponse,type EdResource} from "./transport";

const DECIMAL_ID=/^\d+$/;

export class EdApiClient{
  constructor(
    private readonly token:string,
    private readonly fetchImpl:typeof fetch=fetch,
  ){}

  fetchUser():Promise<unknown>{
    return this.request({kind:"user"},"ED_UPSTREAM_ERROR");
  }

  fetchLessons(courseId:string):Promise<unknown>{
    if(!DECIMAL_ID.test(courseId)){
      return Promise.reject(new EdSourceError("ED_COURSE_UNAVAILABLE","Ed course identity was invalid."));
    }
    return this.request({kind:"lessons",courseId},"ED_COURSE_UNAVAILABLE");
  }

  private async request(resource:EdResource,notFoundCode:"ED_UPSTREAM_ERROR"|"ED_COURSE_UNAVAILABLE"):Promise<unknown>{
    let response:Response;
    const timeout=AbortSignal.timeout(15_000);
    const fetchImpl=this.fetchImpl;
    try{
      response=await fetchEdResponse(this.token,resource,fetchImpl,timeout);
    }catch{
      reportSourceRequestFailure("ed",timeout.aborted?"timeout":"transport");
      throw new EdSourceError(
        "ED_NETWORK_ERROR",
        timeout.aborted
          ?"Ed did not respond within 15 seconds. Try again."
          :"Ed could not be reached from Kairos. Try again.",
      );
    }

    if(!response.ok)reportSourceRequestFailure("ed","http",response.status);
    if(response.status===401||response.status===403){
      throw new EdSourceError("ED_AUTH_INVALID","Ed rejected the API token. Update it and try again.");
    }
    if(response.status===429){
      throw new EdSourceError("ED_RATE_LIMITED","Ed is rate limiting requests. Try again later.");
    }
    if(response.status===404&&notFoundCode==="ED_COURSE_UNAVAILABLE"){
      throw new EdSourceError("ED_COURSE_UNAVAILABLE","This Ed course could not be read.");
    }
    if(!response.ok){
      throw new EdSourceError("ED_UPSTREAM_ERROR",`Ed returned HTTP ${response.status}. Try again.`);
    }

    try{
      return await response.json();
    }catch{
      throw new EdSourceError("ED_PARSE_ERROR","Ed returned data Kairos could not read.");
    }
  }
}
