import {EdSourceError} from "./errors";

export type EdResource={kind:"user"}|{kind:"lessons";courseId:string};

/** Ed never follows redirects: bearer credentials stay at the fixed API destination. */
export function fetchEdResponse(token:string,resource:EdResource,fetchImpl:typeof fetch,signal:AbortSignal):Promise<Response>{
  if(resource.kind==="lessons"&&!/^\d+$/.test(resource.courseId)){
    return Promise.reject(new EdSourceError("ED_COURSE_UNAVAILABLE","Ed course identity was invalid."));
  }
  signal.throwIfAborted();
  const path=resource.kind==="user"?"user":`courses/${resource.courseId}/lessons`;
  return fetchImpl(new URL(path,"https://us.edstem.org/api/"),{
    method:"GET",headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},redirect:"manual",signal,
  });
}
