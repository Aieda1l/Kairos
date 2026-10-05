import { EdSourceError } from "./errors";

const ED_API_BASE="https://us.edstem.org/api/";
const DECIMAL_ID=/^\d+$/;

export class EdApiClient{
  constructor(
    private readonly token:string,
    private readonly fetchImpl:typeof fetch=fetch,
  ){}

  fetchUser():Promise<unknown>{
    return this.request("user","ED_UPSTREAM_ERROR");
  }

  fetchLessons(courseId:string):Promise<unknown>{
    if(!DECIMAL_ID.test(courseId)){
      return Promise.reject(new EdSourceError("ED_COURSE_UNAVAILABLE","Ed course identity was invalid."));
    }
    return this.request(`courses/${courseId}/lessons`,"ED_COURSE_UNAVAILABLE");
  }

  private async request(path:string,notFoundCode:"ED_UPSTREAM_ERROR"|"ED_COURSE_UNAVAILABLE"):Promise<unknown>{
    const url=new URL(path,ED_API_BASE);
    let response:Response;
    try{
      response=await this.fetchImpl(url,{
        method:"GET",
        headers:{
          Authorization:`Bearer ${this.token}`,
          Accept:"application/json",
        },
        redirect:"error",
        signal:AbortSignal.timeout(15_000),
      });
    }catch{
      throw new EdSourceError("ED_NETWORK_ERROR","Ed could not be reached. Try again.");
    }

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
