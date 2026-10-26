import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {openD1TestDatabase} from '../helpers/d1-test-db';
import {canvasEvent,canvasFeed,edCourses,edLessons,feedUrl,requestId,token} from '../helpers/guest-source-fixtures';
import {createGuestSourceHandler} from '@/lib/guest/server/source-handler';
import {resolveGuestServerRuntime} from '@/lib/guest/server/runtime';
import {guestCapabilityCookie,mintGuestCapability} from '@/lib/guest/server/capability';
import {guestApiErrorSchema,guestCanvasFeedResponseSchema,guestEdCoursesResponseSchema,guestEdLessonsResponseSchema} from '@/lib/guest/sources/contracts';
import {getGuestEnabled} from '@/lib/guest/server/feature';

vi.mock('@/lib/guest/server/feature',()=>({getGuestEnabled:vi.fn(async()=>true)}));
const databases:ReturnType<typeof openD1TestDatabase>[]=[];
beforeEach(()=>{vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Real network forbidden'));});
afterEach(()=>{for(const database of databases.splice(0))database.close();vi.useRealTimers();vi.restoreAllMocks();vi.mocked(getGuestEnabled).mockResolvedValue(true);});
const origin='https://kairos.example';
const operations=['canvas-feed','ed-courses','ed-lessons'] as const;
const bodies={
  'canvas-feed':{schemaVersion:1,requestId,feedUrl},
  'ed-courses':{schemaVersion:1,requestId,token},
  'ed-lessons':{schemaVersion:1,requestId,token,courseId:'12'},
};
const schemas={'canvas-feed':guestCanvasFeedResponseSchema,'ed-courses':guestEdCoursesResponseSchema,'ed-lessons':guestEdLessonsResponseSchema};
async function setup(){
  const database=openD1TestDatabase();databases.push(database);
  const fetchImpl=vi.fn<typeof fetch>(async input=>{
    const url=String(input);
    if(url===feedUrl)return new Response(canvasFeed([canvasEvent(1)]));
    if(url==='https://us.edstem.org/api/user')return Response.json(edCourses(1));
    if(url==='https://us.edstem.org/api/courses/12/lessons')return Response.json(edLessons(1));
    throw new Error('Unexpected synthetic destination');
  });
  const runtime=resolveGuestServerRuntime({DB:database.db,KAIROS_GUEST_ENABLED:'true',KAIROS_ABUSE_KEY_V1:Buffer.alloc(32,1).toString('base64url'),KAIROS_APP_URL:origin,KAIROS_ABUSE_TRUSTED_INGRESS:'cloudflare',KAIROS_TURNSTILE_SITE_KEY:'site-key',KAIROS_TURNSTILE_SECRET_KEY:'secret-key'},fetchImpl);
  const capability=await mintGuestCapability(runtime,runtime.now());
  const cookie=guestCapabilityCookie(runtime,capability.value).split(';')[0];
  const getRuntime=vi.fn(async()=>runtime);
  function request(operation:typeof operations[number]='ed-courses',value:unknown=bodies[operation],headers:Record<string,string>={}){
    return new Request(origin+'/api/guest/sources/'+operation,{method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':'203.0.113.8',cookie,...headers},body:JSON.stringify(value)});
  }
  return {...database,runtime,fetchImpl,getRuntime,cookie,request,handler:(operation:typeof operations[number]='ed-courses')=>createGuestSourceHandler(operation,getRuntime)};
}
async function error(response:Response,status:number,code:string){
  expect(response.status).toBe(status);expect(response.headers.get('cache-control')).toBe('no-store');
  const value=await response.json();expect(guestApiErrorSchema.safeParse(value).success).toBe(true);expect(value.code).toBe(code);
  expect(response.headers.get('set-cookie')).toBeNull();return value;
}
describe('transient guest source API',()=>{
  it.each(operations)('reads %s with a guest capability and validates the public DTO',async operation=>{
    const {handler,request,fetchImpl}=await setup();const response=await handler(operation)(request(operation));
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
    const result=await response.json();expect(schemas[operation].safeParse(result).success).toBe(true);
    expect(result.requestId).toBe(requestId);expect(JSON.stringify(result)).not.toContain(token);expect(JSON.stringify(result)).not.toContain(feedUrl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('gates disabled features before runtime creation or database access',async()=>{
    const {handler,request,getRuntime,sqlite}=await setup();vi.mocked(getGuestEnabled).mockResolvedValue(false);
    await error(await handler()(request()),404,'GUEST_DISABLED');expect(getRuntime).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT * FROM abuse_rate_events').all()).toEqual([]);
  });
  it('rejects a disabled injected runtime without source calls',async()=>{
    const {handler,request,runtime,fetchImpl}=await setup();runtime.guestEnabled=false;
    await error(await handler()(request()),404,'GUEST_DISABLED');expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects GET, content type, extra fields, malformed JSON and streamed oversize bodies before providers',async()=>{
    const {handler,request,fetchImpl,sqlite}=await setup();
    await error(await handler()(new Request(origin+'/api/guest/sources/ed/courses',{headers:{origin}})),400,'BAD_REQUEST');
    await error(await handler()(request('ed-courses',bodies['ed-courses'],{'content-type':'text/plain'})),415,'UNSUPPORTED_MEDIA_TYPE');
    for(const value of [{...bodies['ed-courses'],userId:'someone'}, {...bodies['ed-courses'],token:''}, {...bodies['ed-lessons'],courseId:'x'}])await error(await handler()(request('ed-courses',value)),400,'BAD_REQUEST');
    for(const bytes of [new TextEncoder().encode(' '.repeat(16_385)),new Uint8Array([0xff]),new TextEncoder().encode('{')]){
      const req=request();const streamed=new Request(req.url,{method:'POST',headers:req.headers,body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),duplex:'half'} as RequestInit);
      streamed.headers.set('content-length','1');await error(await handler()(streamed),400,'BAD_REQUEST');
    }
    expect(fetchImpl).not.toHaveBeenCalled();expect(sqlite.prepare('SELECT * FROM abuse_rate_events').all()).toEqual([]);
  });
  it.each<Record<string,string>>([{origin:'https://foreign.example'},{host:'foreign.example'},{'x-forwarded-host':'foreign.example'},{'x-forwarded-proto':'http'}])('rejects forged origin hints %j',async headers=>{
    const {handler,request,fetchImpl,sqlite}=await setup();await error(await handler()(request('ed-courses',bodies['ed-courses'],headers)),403,'UNTRUSTED_ORIGIN');
    expect(fetchImpl).not.toHaveBeenCalled();expect(sqlite.prepare('SELECT * FROM abuse_rate_events').all()).toEqual([]);
  });
  it('account cookies do not authorize, nor does a forged or expired guest capability',async()=>{
    const {handler,request,fetchImpl,runtime}=await setup();
    for(const cookie of ['','authjs.session-token=existing-account','__Host-kairos-guest-sync=forged'])await error(await handler()(request('ed-courses',bodies['ed-courses'],{cookie})),401,'GUEST_SESSION_REQUIRED');
    const expired=await mintGuestCapability(runtime,runtime.now()-1_800_001);
    await error(await handler()(request('ed-courses',bodies['ed-courses'],{cookie:guestCapabilityCookie(runtime,expired.value)})),401,'GUEST_SESSION_REQUIRED');expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('ignores account cookies and selects only request-local provider data',async()=>{
    const {handler,request,cookie}=await setup();
    const first=await (await handler()(request())).json();
    const second=await (await handler()(request('ed-courses',bodies['ed-courses'],{cookie:cookie+'; authjs.session-token=other-account'}))).json();
    expect(second.courses).toEqual(first.courses);expect(second.courses[0].externalCourseId).toBe('1');
  });
  it.each(['canvas-feed','ed-courses'] as const)('rejects paused %s provider before dispatch',async operation=>{
    const {handler,request,sqlite,fetchImpl}=await setup();
    sqlite.prepare('UPDATE abuse_controls SET enabled=0 WHERE control_key=?').run(operation==='canvas-feed'?'provider:canvas':'provider:ed');
    await error(await handler(operation)(request(operation)),503,'SERVICE_UNAVAILABLE');expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects control version drift before a Canvas redirect dispatch',async()=>{
    const {handler,request,sqlite,fetchImpl}=await setup();
    fetchImpl.mockImplementationOnce(async()=>{sqlite.exec("UPDATE abuse_controls SET version=version+2 WHERE control_key='provider:canvas'");return new Response(null,{status:302,headers:{location:'https://canvas.uw.edu/feeds/calendars/next.ics'}});});
    await error(await handler('canvas-feed')(request('canvas-feed')),503,'SERVICE_UNAVAILABLE');expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('rechecks the admitted control version before the first provider dispatch',async()=>{
    const {handler,request,sqlite,fetchImpl}=await setup();
    sqlite.exec("CREATE TRIGGER drift_guest_control AFTER INSERT ON abuse_rate_events BEGIN UPDATE abuse_controls SET version=version+1 WHERE control_key='provider:ed'; END;");
    await error(await handler()(request()),503,'SERVICE_UNAVAILABLE');expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects pause/resume version drift before emitting a successful DTO',async()=>{
    const {handler,request,sqlite,fetchImpl}=await setup();
    fetchImpl.mockImplementationOnce(async()=>{sqlite.exec("UPDATE abuse_controls SET version=version+2 WHERE control_key='provider:ed'");return Response.json(edCourses(1));});
    await error(await handler()(request()),503,'SERVICE_UNAVAILABLE');
  });
  it.each(['abuse_controls','abuse_rate_events'])('fails closed when %s storage is unavailable',async table=>{
    const {handler,request,sqlite,fetchImpl}=await setup();sqlite.exec(`DROP TABLE ${table}`);
    await error(await handler()(request()),503,'SERVICE_UNAVAILABLE');expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('uses the actual 30-read session budget and returns bounded Retry-After without dispatch',async()=>{
    const {handler,request,fetchImpl}=await setup();for(let i=0;i<30;i++)expect((await handler()(request())).status).toBe(200);
    const response=await handler()(request());const result=await error(response,429,'RATE_LIMITED');
    expect(response.headers.get('retry-after')).toBe(String(result.retryAfterSeconds));expect(fetchImpl).toHaveBeenCalledTimes(30);
  });
  it.each([
    ['canvas-feed',401,'UNAUTHORIZED_OR_EXPIRED_FEED'],['ed-courses',403,'ED_AUTH_INVALID'],
    ['ed-lessons',404,'ED_COURSE_UNAVAILABLE'],['ed-courses',429,'ED_RATE_LIMITED'],
  ] as const)('maps %s upstream %s to fixed 422 %s',async(operation,status,code)=>{
    const {handler,request,fetchImpl}=await setup();fetchImpl.mockResolvedValueOnce(new Response('SECRET_MARKER',{status}));
    expect(JSON.stringify(await error(await handler(operation)(request(operation)),422,code))).not.toContain('SECRET_MARKER');
  });
  it('rejects oversized source output atomically',async()=>{
    const {handler,request,fetchImpl}=await setup();fetchImpl.mockResolvedValueOnce(Response.json(edCourses(501)));
    await error(await handler()(request()),422,'SOURCE_RESULT_TOO_LARGE');
  });
  it('never leaks thrown provider secrets in response or log structures',async()=>{
    const {handler,request,fetchImpl}=await setup();const spies=[vi.spyOn(console,'log'),vi.spyOn(console,'warn'),vi.spyOn(console,'error'),vi.spyOn(console,'info')];
    fetchImpl.mockRejectedValueOnce(new Error('SECRET_MARKER body token feed'));
    const result=await error(await handler()(request()),422,'ED_NETWORK_ERROR');
    expect(JSON.stringify([result,...spies.map(spy=>spy.mock.calls)])).not.toContain('SECRET_MARKER');
  });
  it('bounds the entire operation including a stalled source by 15 seconds',async()=>{
    const {handler,request,fetchImpl}=await setup();vi.useFakeTimers();fetchImpl.mockImplementationOnce(async()=>new Promise(()=>{}));
    const pending=handler()(request());await vi.waitFor(()=>expect(fetchImpl).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(15_001);await error(await pending,422,'ED_NETWORK_ERROR');
  });
  it('does not restart the deadline after a slow request body',async()=>{
    const {handler,request,fetchImpl}=await setup();vi.useFakeTimers();
    fetchImpl.mockImplementationOnce(async()=>new Promise(()=>{}));
    const req=request();const started=Date.now();
    const slow=new Request(req.url,{method:'POST',headers:req.headers,body:new ReadableStream({start(controller){setTimeout(()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify(bodies['ed-courses'])));controller.close();},14_000);}}),duplex:'half'} as RequestInit);
    let settled=false;const pending=handler()(slow).then(response=>{settled=true;return response;});
    await vi.advanceTimersByTimeAsync(14_000);await vi.waitFor(()=>expect(fetchImpl).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(15_000-(Date.now()-started)-1);expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);await error(await pending,422,'ED_NETWORK_ERROR');
  });
  it('does not dispatch after a runtime lookup resolves past the deadline',async()=>{
    const {request,runtime,fetchImpl}=await setup();vi.useFakeTimers();
    let release!:(value:typeof runtime)=>void;
    const getRuntime=vi.fn(()=>new Promise<typeof runtime>(resolve=>{release=resolve;}));
    const pending=createGuestSourceHandler('ed-courses',getRuntime)(request());
    await vi.advanceTimersByTimeAsync(15_000);await error(await pending,422,'ED_NETWORK_ERROR');
    release(runtime);await vi.advanceTimersByTimeAsync(0);expect(fetchImpl).not.toHaveBeenCalled();
  });
});
