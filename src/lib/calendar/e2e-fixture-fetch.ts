import "server-only";

export const E2E_CALDAV_USERNAME="student@example.com";
export const E2E_CALDAV_SECRET="fixture-app-password-never-echo";

const ROOT="https://caldav.icloud.com/";
const PARTITION="https://p12-caldav.icloud.com";
const PRINCIPAL=PARTITION+"/fixture/principal/";
const HOME=PARTITION+"/fixture/calendars/";
const CALENDAR=HOME+"kairos/";

type FixtureMode="normal"|"network-error";

export type E2ECalendarEvent={
  id:string;
  summary:string;
  startsAt:string;
  endsAt:string;
};

type StoredEvent=E2ECalendarEvent&{
  etag:string;
  raw:string;
};

type FixtureStore={
  mode:FixtureMode;
  calendarExists:boolean;
  etagCounter:number;
  events:Map<string,StoredEvent>;
};

const fixtureGlobal=globalThis as typeof globalThis&{
  __kairosCalendarE2EFixture?:FixtureStore;
};
const store=fixtureGlobal.__kairosCalendarE2EFixture??={
  mode:"normal",
  calendarExists:true,
  etagCounter:0,
  events:new Map<string,StoredEvent>(),
};
fixtureGlobal.__kairosCalendarE2EFixture=store;

function xml(body:string,status=207):Response{
  return new Response(body,{
    status,
    headers:{
      "content-type":"application/xml; charset=utf-8",
      "cache-control":"no-store",
    },
  });
}

function empty(status:number):Response{
  return new Response(null,{
    status,
    headers:{"cache-control":"no-store"},
  });
}

function expectedAuthorization():string{
  return "Basic "+Buffer.from(`${E2E_CALDAV_USERNAME}:${E2E_CALDAV_SECRET}`).toString("base64");
}

function principalXml():string{
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/</d:href>
    <d:propstat><d:prop>
      <d:current-user-principal><d:href>${PRINCIPAL}</d:href></d:current-user-principal>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;
}

function homeXml():string{
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/fixture/principal/</d:href>
    <d:propstat><d:prop>
      <c:calendar-home-set><d:href>${HOME}</d:href></c:calendar-home-set>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;
}

function calendarCollectionXml():string{
  if(!store.calendarExists){
    return `<?xml version="1.0" encoding="UTF-8"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/fixture/calendars/kairos/</d:href>
    <d:propstat><d:prop>
      <d:displayname>Kairos</d:displayname>
      <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
      <d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>`;
}

function unfoldIcal(raw:string):string{
  return raw.replace(/\r?\n[ \t]/g,"");
}

function unescapeIcal(value:string):string{
  return value
    .replace(/\\n/gi,"\n")
    .replace(/\\,/g,",")
    .replace(/\\;/g,";")
    .replace(/\\\\/g,"\\");
}

function field(raw:string,name:string):string{
  const match=unfoldIcal(raw).match(new RegExp(`^${name}(?:;[^:]*)?:(.*)$`,"mi"));
  return match?.[1]?.trim()??"";
}

function icalUtcToIso(value:string):string{
  const match=value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if(!match)return value;
  const [,year,month,day,hour,minute,second]=match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}

function eventFromBody(id:string,raw:string):StoredEvent{
  store.etagCounter++;
  return {
    id,
    summary:unescapeIcal(field(raw,"SUMMARY")),
    startsAt:icalUtcToIso(field(raw,"DTSTART")),
    endsAt:icalUtcToIso(field(raw,"DTEND")),
    etag:`"fixture-etag-${store.etagCounter}"`,
    raw,
  };
}

function isDavUrl(url:URL):boolean{
  return url.origin==="https://caldav.icloud.com"
    ||/^https:\/\/p\d+-caldav\.icloud\.com$/.test(url.origin);
}

const fixtureFetch:typeof fetch=async(input,init)=>{
  const url=new URL(typeof input==="string"?input:input instanceof URL?input.toString():input.url);
  if(!isDavUrl(url))throw new Error("E2E Calendar fixture rejected a non-Apple origin.");
  if(store.mode==="network-error")throw new Error("fixture calendar network error");

  const headers=new Headers(init?.headers);
  if(headers.get("authorization")!==expectedAuthorization()){
    return empty(401);
  }

  const method=(init?.method??"GET").toUpperCase();
  if(method==="PROPFIND"&&url.href===ROOT)return xml(principalXml());
  if(method==="PROPFIND"&&url.href===PRINCIPAL)return xml(homeXml());
  if(method==="PROPFIND"&&url.href===HOME)return xml(calendarCollectionXml());
  if(method==="PROPFIND"&&url.href===CALENDAR){
    return store.calendarExists?xml(calendarCollectionXml()):empty(404);
  }

  if(url.href.startsWith(CALENDAR)&&url.pathname.endsWith(".ics")){
    if(!store.calendarExists)return empty(404);
    const id=url.pathname.split("/").at(-1)!;
    if(method==="GET"){
      const event=store.events.get(id);
      return event
        ?new Response(event.raw,{
          status:200,
          headers:{
            etag:event.etag,
            "content-type":"text/calendar; charset=utf-8",
            "cache-control":"no-store",
          },
        })
        :empty(404);
    }
    if(method==="PUT"){
      const existing=store.events.get(id);
      if(headers.get("if-none-match")==="*"&&existing)return empty(412);
      const raw=String(init?.body??"");
      const event=eventFromBody(id,raw);
      store.events.set(id,event);
      return new Response(null,{status:existing?204:201,headers:{etag:event.etag,"cache-control":"no-store"}});
    }
    if(method==="DELETE"){
      store.events.delete(id);
      return empty(204);
    }
  }

  return empty(404);
};

export function getCalendarRouteFetch():typeof fetch{
  return process.env.E2E_FIXTURES==="1"?fixtureFetch:fetch;
}

export function resetE2ECalendarFixture():void{
  store.mode="normal";
  // Simulate the writable Kairos calendar users create in iCloud before connecting.
  store.calendarExists=true;
  store.etagCounter=0;
  store.events.clear();
}

export function getE2ECalendarFixtureState():{
  mode:FixtureMode;
  calendarExists:boolean;
  events:E2ECalendarEvent[];
}{
  return {
    mode:store.mode,
    calendarExists:store.calendarExists,
    events:Array.from(store.events.values())
      .map(({id,summary,startsAt,endsAt})=>({id,summary,startsAt,endsAt}))
      .sort((a,b)=>a.id.localeCompare(b.id)),
  };
}

export function setE2ECalendarFixtureMode(next:FixtureMode):void{
  store.mode=next;
}

export function deleteE2ECalendarFixtureEvent(eventId:string):boolean{
  return store.events.delete(eventId);
}
