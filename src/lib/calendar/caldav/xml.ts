import "server-only";
import {XMLParser} from "fast-xml-parser";
import {CalendarSyncError} from "@/lib/calendar/errors";

export type CalDavCalendarCollection={
  href:string;
  name:string;
  writable:boolean;
};

function fail():never{
  throw new CalendarSyncError(
    "CALDAV_DISCOVERY_FAILED",
    "Apple Calendar discovery returned an unexpected response.",
  );
}

function rejectDangerousXml(xml:string):void{
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))fail();
}

function parser(){
  return new XMLParser({
    removeNSPrefix:true,
    ignoreAttributes:false,
    trimValues:true,
    parseTagValue:false,
  });
}

function asArray<T>(value:T|T[]|undefined|null):T[]{
  if(value===undefined||value===null)return [];
  return Array.isArray(value)?value:[value];
}

function textValue(value:unknown):string|null{
  if(typeof value==="string")return value;
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    const row=value as Record<string,unknown>;
    if(typeof row["#text"]==="string")return row["#text"];
  }
  return null;
}

function findFirst(node:unknown,key:string):unknown{
  if(!node||typeof node!=="object")return undefined;
  if(Array.isArray(node)){
    for(const item of node){
      const found=findFirst(item,key);
      if(found!==undefined)return found;
    }
    return undefined;
  }
  const row=node as Record<string,unknown>;
  if(key in row)return row[key];
  for(const value of Object.values(row)){
    const found=findFirst(value,key);
    if(found!==undefined)return found;
  }
  return undefined;
}

function hasKey(node:unknown,key:string):boolean{
  return findFirst(node,key)!==undefined;
}

function parse(xml:string):unknown{
  rejectDangerousXml(xml);
  try{return parser().parse(xml);}catch{fail();}
}

export function resolveAppleDavUrl(base:URL,href:string):URL{
  let url:URL;
  try{url=new URL(href,base);}catch{fail();}
  if(url.protocol!=="https:")fail();
  if(url.username||url.password)fail();
  if(url.port&&url.port!=="443")fail();
  const host=url.hostname.toLowerCase();
  if(host!=="caldav.icloud.com"&&!/^p\d+-caldav\.icloud\.com$/.test(host))fail();
  return url;
}

export function parseCurrentUserPrincipal(xml:string):string{
  const root=parse(xml);
  const principal=findFirst(root,"current-user-principal");
  const href=textValue(findFirst(principal,"href"));
  if(!href)fail();
  return href;
}

export function parseCalendarHomeSet(xml:string):string{
  const root=parse(xml);
  const home=findFirst(root,"calendar-home-set");
  const href=textValue(findFirst(home,"href"));
  if(!href)fail();
  return href;
}

export function parseCalendarCollections(xml:string):CalDavCalendarCollection[]{
  const root=parse(xml) as Record<string,unknown>;
  const responses=asArray(findFirst(root,"response"));
  const collections:CalDavCalendarCollection[]=[];
  for(const response of responses){
    if(!response||typeof response!=="object")continue;
    const href=textValue((response as Record<string,unknown>).href);
    if(!href)continue;
    const propstats=asArray((response as Record<string,unknown>).propstat);
    for(const propstat of propstats){
      if(!propstat||typeof propstat!=="object")continue;
      const prop=(propstat as Record<string,unknown>).prop;
      if(!prop||typeof prop!=="object")continue;
      if(!hasKey((prop as Record<string,unknown>).resourcetype,"calendar"))continue;
      const name=textValue((prop as Record<string,unknown>).displayname)??"Calendar";
      const privileges=(prop as Record<string,unknown>)["current-user-privilege-set"];
      const writable=
        hasKey(privileges,"all")
        ||hasKey(privileges,"write")
        ||(hasKey(privileges,"bind")&&hasKey(privileges,"write-content"));
      collections.push({href,name,writable});
      break;
    }
  }
  return collections;
}
