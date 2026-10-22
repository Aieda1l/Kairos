import {describe,expect,it} from 'vitest';
import {CalDavClient} from '@/lib/calendar/caldav/client';

const calendar='https://p12-caldav.icloud.com/123/kairos/';
const document=(rows:string)=>'<d:multistatus xmlns:d="DAV:">'+rows+'</d:multistatus>';
const present=(href:string,etag='&quot;etag&quot;')=>'<d:response><d:href>'+href+'</d:href><d:propstat><d:prop><d:getetag>'+etag+'</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';

describe('bounded CalDAV multiget transport',()=>{
 it('escapes resource hrefs and accepts out-of-order DAV responses',async()=>{
  const calls:Array<{url:string;method:string;body:string}>=[];
  const client=new CalDavClient('synthetic@example.invalid','synthetic',async(input,init)=>{
   calls.push({url:String(input),method:init?.method??'GET',body:String(init?.body)});
   return new Response(document('<d:response><d:href>/123/kairos/b.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>'+present('a&amp;c.ics')),{status:207});
  });
  const result=await client.getEvents(calendar,['a&c.ics','b.ics']);
  expect([...result]).toEqual([['b.ics',null],['a&c.ics',{remoteEventId:'a&c.ics',etag:'"etag"'}]]);
  expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({url:calendar,method:'REPORT'});
  expect(calls[0]!.body).toContain('<d:href>/123/kairos/a&amp;c.ics</d:href>');
  expect(calls[0]!.body).not.toContain('calendar-data');
 });
 it.each([
  document(present('a.ics')+present('a.ics')),
  document(present('a.ics')+present('b.ics')),
  document(''),
  document('<d:response><d:href>a.ics</d:href><d:propstat><d:prop><d:getetag>"tag"</d:getetag></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>'),
  document(present('a.ics','')),
  document(present('a.ics','invalid')),
  document(present('a.ics')).replace('xmlns:d="DAV:"','xmlns:d="https://evil.invalid/"'),
  document(present('a.ics')).replace('<d:getetag>','<d:getetag xmlns:d="https://evil.invalid/">'),
  document(present('https://p13-caldav.icloud.com/123/kairos/a.ics')),
  '<!DOCTYPE x [<!ENTITY secret "private">]>'+document(present('a.ics','&secret;')),
  '<d:multistatus xmlns:d="DAV:">',
 ])('rejects ambiguous metadata without turning it into absence (%#)',async xml=>{
  let requests=0;
  const client=new CalDavClient('synthetic@example.invalid','synthetic',async()=>{requests++;return new Response(xml,{status:207});});
  await expect(client.getEvents(calendar,['a.ics'])).rejects.toMatchObject({code:'CALENDAR_UPSTREAM_ERROR'});
  expect(requests).toBe(1);
 });
 it.each(['../other.ics','https://p12-caldav.icloud.com/other/a.ics','a.ics?token=value','a.ics#fragment','nested/a.ics'])('refuses an escaping input before sending credentials: %s',async id=>{
  let requests=0;
  const client=new CalDavClient('synthetic@example.invalid','synthetic',async()=>{requests++;return new Response(null,{status:500});});
  await expect(client.getEvents(calendar,[id])).rejects.toBeDefined();expect(requests).toBe(0);
 });
 it('refuses oversized batches before transport',async()=>{
  let requests=0;
  const client=new CalDavClient('synthetic@example.invalid','synthetic',async()=>{requests++;return new Response(null,{status:500});});
  await expect(client.getEvents(calendar,Array.from({length:33},(_,i)=>i+'.ics'))).rejects.toBeDefined();expect(requests).toBe(0);
 });
 it('bounds a streaming response even when Content-Length is absent',async()=>{
  let cancelled=false;
  const client=new CalDavClient('synthetic@example.invalid','synthetic',async()=>new Response(new ReadableStream({
   start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(65537)));},cancel(){cancelled=true;},
  }),{status:207}));
  await expect(client.getEvents(calendar,['a.ics'])).rejects.toMatchObject({code:'CALENDAR_UPSTREAM_ERROR'});expect(cancelled).toBe(true);
 });
 it('does not downgrade authentication failures to individual GET requests',async()=>{
  let requests=0;
  const client=new CalDavClient('synthetic@example.invalid','synthetic',async()=>{requests++;return new Response(null,{status:401});});
  await expect(client.getEvents(calendar,['a.ics'])).rejects.toMatchObject({code:'CALENDAR_AUTH_REQUIRED'});expect(requests).toBe(1);
 });
 it('preserves a resource-level authentication rejection inside a 207 response',async()=>{
  const client=new CalDavClient('synthetic@example.invalid','synthetic',async()=>new Response(document('<d:response><d:href>a.ics</d:href><d:status>HTTP/1.1 401 Unauthorized</d:status></d:response>'),{status:207}));
  await expect(client.getEvents(calendar,['a.ics'])).rejects.toMatchObject({code:'CALENDAR_AUTH_REQUIRED'});
 });
});
