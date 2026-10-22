import 'server-only';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import type {RemoteCalendarEvent} from '@/lib/calendar/adapter';
import {CalendarSyncError} from '@/lib/calendar/errors';
import {resolveAppleDavUrl} from './xml';

export const CALDAV_READ_BATCH_SIZE=32;
const MAX_BYTES=65536;
export function invalidMultiget():CalendarSyncError{
  return new CalendarSyncError('CALENDAR_UPSTREAM_ERROR','Apple Calendar returned incomplete or invalid event metadata.');
}

export function multigetTargets(calendar:URL,ids:readonly string[]):Map<string,URL>{
  if(ids.length>CALDAV_READ_BATCH_SIZE||new Set(ids).size!==ids.length
    ||!calendar.pathname.endsWith('/')||calendar.search||calendar.hash)throw invalidMultiget();
  const targets=new Map<string,URL>();
  for(const id of ids){
    if(/[\u0000-\u001f\u007f]/.test(id))throw invalidMultiget();
    const url=resolveAppleDavUrl(calendar,id);
    const relative=url.pathname.slice(calendar.pathname.length);
    let decoded:string;
    try{decoded=decodeURIComponent(relative);}catch{throw invalidMultiget();}
    if(url.origin!==calendar.origin||!url.pathname.startsWith(calendar.pathname)
      ||!decoded||decoded==='.'||decoded==='..'||/[\/\\%]/.test(decoded)||url.search||url.hash)throw invalidMultiget();
    if([...targets.values()].some(target=>target.href===url.href))throw invalidMultiget();
    targets.set(id,url);
  }
  return targets;
}

export function multigetBody(targets:ReadonlyMap<string,URL>):string{
  const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
  const body='<?xml version="1.0" encoding="UTF-8"?><c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/></d:prop>'
    +[...targets.values()].map(url=>'<d:href>'+escape(url.pathname)+'</d:href>').join('')+'</c:calendar-multiget>';
  if(new TextEncoder().encode(body).byteLength>MAX_BYTES)throw invalidMultiget();
  return body;
}

export async function readMultigetBody(response:Response):Promise<string>{
  if(!response.body)throw invalidMultiget();
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){
      const next=await reader.read();if(next.done)break;
      size+=next.value.byteLength;if(size>MAX_BYTES)throw invalidMultiget();chunks.push(next.value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }catch{throw invalidMultiget();}
  finally{await reader.cancel().catch(()=>{});}
}

type Element={value:unknown;namespaces:Record<string,string>};
function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalidMultiget();
  return value as Record<string,unknown>;
}
function children(parent:Element,local:string):Element[]{
  const found:Element[]=[];
  for(const [name,values] of Object.entries(record(parent.value))){
    if(name.startsWith('@_')||name.startsWith('?')||name==='#text')continue;
    for(const value of Array.isArray(values)?values:[values]){
      const namespaces={...parent.namespaces};
      if(value&&typeof value==='object')for(const [key,uri] of Object.entries(record(value))){
        if(key==='@_xmlns'||key.startsWith('@_xmlns:')){
          if(typeof uri!=='string')throw invalidMultiget();
          namespaces[key==='@_xmlns'?'':key.slice(8)]=uri;
        }
      }
      const parts=name.split(':');
      if(parts.length>2)throw invalidMultiget();
      const prefix=parts.length===2?parts[0]!:'';
      if(parts.at(-1)===local&&namespaces[prefix]==='DAV:')found.push({value,namespaces});
    }
  }
  return found;
}
function one(parent:Element,name:string):Element{
  const nodes=children(parent,name);if(nodes.length!==1)throw invalidMultiget();return nodes[0]!;
}
function text(node:Element):string{
  if(typeof node.value==='string')return node.value;
  const row=record(node.value);
  if(Object.keys(row).some(key=>key!=='#text'&&!key.startsWith('@_'))||typeof row['#text']!=='string')throw invalidMultiget();
  return row['#text'];
}
function status(node:Element):number{
  const match=text(node).match(/^HTTP\/\d(?:\.\d)?[ \t]+([1-5]\d{2})(?:[ \t].*)?$/);
  if(!match)throw invalidMultiget();return Number(match[1]);
}

export function parseMultiget(xml:string,calendar:URL,targets:ReadonlyMap<string,URL>,statusError:(code:number)=>Error):Map<string,RemoteCalendarEvent|null>{
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw invalidMultiget();
  let document:unknown;
  try{document=new XMLParser({ignoreAttributes:false,trimValues:true,parseTagValue:false}).parse(xml);}catch{throw invalidMultiget();}
  const root=one({value:document,namespaces:{}},'multistatus');
  const responses=children(root,'response');
  if(responses.length!==targets.size)throw invalidMultiget();
  const byUrl=new Map([...targets].map(([id,url])=>[url.href,id])),result=new Map<string,RemoteCalendarEvent|null>();
  for(const response of responses){
    const href=text(one(response,'href'));
    let url:URL;try{url=resolveAppleDavUrl(calendar,href);}catch{throw invalidMultiget();}
    const id=byUrl.get(url.href);
    if(id===undefined||result.has(id))throw invalidMultiget();
    const statuses=children(response,'status'),propstats=children(response,'propstat');
    if(statuses.length===1&&propstats.length===0){
      const code=status(statuses[0]!);
      if(code===404){result.set(id,null);continue;}
      if(code>=400)throw statusError(code);
    }
    if(statuses.length||!propstats.length)throw invalidMultiget();
    const tags:string[]=[];
    for(const propstat of propstats){
      const props=children(one(propstat,'prop'),'getetag');
      if(!props.length)continue;
      const code=status(one(propstat,'status'));
      if(code!==200)throw code>=400?statusError(code):invalidMultiget();
      if(props.length!==1)throw invalidMultiget();
      tags.push(text(props[0]!));
    }
    if(tags.length!==1||!/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(tags[0]!))throw invalidMultiget();
    result.set(id,{remoteEventId:id,etag:tags[0]!});
  }
  return result;
}
