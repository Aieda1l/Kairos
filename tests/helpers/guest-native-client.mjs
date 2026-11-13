// Node-simulated foreground client. Every response remains an actual HTTP
// response; the normalized value is explicitly a local derived projection.
import assert from 'node:assert/strict';
export async function readNativeGuestSource({send,pipeline,operation,requestId,courseId=null,fields,readPath,approvePath,serverDeadlineProbe=false}){
 const calls=[],deadline=Date.now()+(serverDeadlineProbe?20000:15000);const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),Math.max(1,deadline-Date.now()));
 const current=()=>{if(controller.signal.aborted||Date.now()>=deadline)throw new Error('NATIVE_CLIENT_TIMEOUT');};
 async function call(path,body){current();const response=await send(path,body,controller.signal);current();const metrics=JSON.parse(response.headers.get('x-probe-metrics')??'null');assert(metrics,'actual server metrics');
  const item={path,status:response.status,metrics,headersValid:response.headers.get('cache-control')==='no-store, private'};calls.push(item);assert(item.headersValid);return response;}
 const result=(status,code,value,errorStage)=>({status,code,value,errorStage,calls,projection:'node-simulated-client',physicalRequests:calls.length});
 async function error(response){const data=await response.json();assert(pipeline.guestApiErrorSchema.safeParse(data).success);return data.code;}
 try{
  const raw=await call(readPath,{schemaVersion:2,requestId,...fields});
  if(raw.status!==200)return result(raw.status,await error(raw),undefined,'relay');
  assert.equal((raw.headers.get('content-type')??'').split(';')[0],'application/octet-stream');assert.equal(raw.headers.get('x-kairos-guest-source-version'),'2');
  const receipt=raw.headers.get('x-kairos-guest-read-receipt'),claims=receipt&&pipeline.readGuestReadReceiptMetadata(receipt);
  assert(claims&&claims.operation===operation&&claims.requestId===requestId&&claims.courseId===courseId);
  const bytes=await pipeline.readBoundedBytes(raw.body,{maxBytes:2097152,signal:controller.signal});current();
  calls[0].bodyBytes=bytes.byteLength;
  let value;
  try{value=await pipeline.parseGuestSourceBytes({operation,requestId:claims.requestId,checkedAt:claims.checkedAt,bytes:bytes.buffer,...(courseId===null?{}:{courseId})},{signal:controller.signal,check:current});}
  catch(e){current();assert(typeof e?.code==='string'&&/^[A-Z0-9_]+$/.test(e.code),'fixed client parser code');return result(raw.status,e.code,undefined,'client-parse');}
  current();const schema=operation==='canvas-feed'?pipeline.guestCanvasFeedResponseSchema:operation==='ed-courses'?pipeline.guestEdCoursesResponseSchema:pipeline.guestEdLessonsResponseSchema;
  assert(schema.safeParse(value).success&&value.requestId===requestId&&value.checkedAt===claims.checkedAt);
  const approved=await call(approvePath,{schemaVersion:2,requestId,receipt});
  if(approved.status!==200)return result(approved.status,await error(approved),undefined,'approval');
  const ack=await approved.json();assert(pipeline.guestSourceApprovalAckSchema.safeParse(ack).success&&ack.requestId===requestId&&ack.operation===operation&&ack.courseId===courseId&&ack.checkedAt===claims.checkedAt);current();
  return result(approved.status,undefined,value,undefined);
 }finally{clearTimeout(timer);controller.abort();}
}
