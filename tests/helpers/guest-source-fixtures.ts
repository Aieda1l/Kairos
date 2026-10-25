export const requestId="00000000-0000-4000-8000-000000000001";
export const checkedAt="2026-10-24T12:00:00.000Z";
export const feedUrl="https://canvas.uw.edu/feeds/calendars/synthetic.ics?token=never-echo";
export const token="fixture-token-never-echo";

export function sourceContext(fetchImpl:typeof fetch,signal=new AbortController().signal){
  return {fetchImpl,requestId,checkedAt,signal,assertProviderCurrent:async()=>{}};
}
export function bytesStream(chunks:Uint8Array[],cancel?:()=>Promise<void>){
  return new ReadableStream<Uint8Array>({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();},cancel});
}
export function textResponse(text:string,headers:HeadersInit={}){
  return new Response(bytesStream([new TextEncoder().encode(text)]),{headers});
}
export function canvasEvent(id:number,options:{ordinary?:boolean;title?:string;url?:string}={}){
  return ["BEGIN:VEVENT",`UID:event-${options.ordinary?"calendar":"assignment"}-${id}`,
    `SUMMARY:${options.title??`Homework ${id} [Math]`}`,"DTSTART:20261025T120000Z",
    `URL:${options.url??`https://canvas.uw.edu/courses/12/assignments/${id}`}`,"END:VEVENT"].join("\n");
}
export function canvasFeed(events:string[]){return `BEGIN:VCALENDAR\nVERSION:2.0\n${events.join("\n")}\nEND:VCALENDAR`;}
export function edCourses(count:number){
  return {user:{id:1,email:"private@example.invalid",api_token:token},courses:Array.from({length:count},(_,i)=>({course:{id:i+1,code:`C${i+1}`,name:`Course ${i+1}`,year:2026,session:"Autumn",private_field:token},role:{role:"student"}}))};
}
export function edLessons(count:number,overrides:Record<string,unknown>={}){
  return {modules:[],lessons:Array.from({length:count},(_,i)=>({id:i+1,course_id:12,title:`Lesson ${i+1}`,status:"unattempted",state:"published",is_hidden:false,is_unlisted:false,due_at:checkedAt,private_field:token,...overrides}))};
}
