import type { AssignmentSource, ConnectionResult, SourceAssignment, SourceCourse, SourceKind } from "@/lib/sources/types";
import { EdApiClient } from "./client";
import { EdSourceError } from "./errors";
import { parseEdLessons } from "./parser";

export class EdSource implements AssignmentSource{
  readonly kind:SourceKind="ed";
  private readonly client:EdApiClient;

  constructor(
    token:string,
    private readonly course:SourceCourse,
    fetchImpl:typeof fetch=fetch,
  ){
    this.client=new EdApiClient(token,fetchImpl);
  }

  async testConnection():Promise<ConnectionResult>{
    try{
      const payload=await this.client.fetchLessons(this.course.externalCourseId);
      return {ok:true,itemCount:parseEdLessons(payload,this.course).length};
    }catch(error){
      if(error instanceof EdSourceError)return {ok:false,code:error.code,message:error.message};
      return {ok:false,code:"ED_UPSTREAM_ERROR",message:"Ed could not be tested. Try again."};
    }
  }

  async sync():Promise<SourceAssignment[]>{
    const payload=await this.client.fetchLessons(this.course.externalCourseId);
    return parseEdLessons(payload,this.course);
  }
}
