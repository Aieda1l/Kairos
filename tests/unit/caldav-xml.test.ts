import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";
import {
  parseCalendarCollections,
  parseCalendarHomeSet,
  parseCurrentUserPrincipal,
  resolveAppleDavUrl,
} from "@/lib/calendar/caldav/xml";

const fixture=(name:string)=>fs.readFileSync(
  path.join(process.cwd(),"tests/fixtures/caldav",name),
  "utf8",
);

describe("Apple CalDAV URL and XML safety",()=>{
  it("allows only Apple HTTPS CalDAV entry and partition hosts",()=>{
    const root=new URL("https://caldav.icloud.com/");
    expect(resolveAppleDavUrl(root,"/123/principal/").href).toBe("https://caldav.icloud.com/123/principal/");
    expect(resolveAppleDavUrl(root,"https://p12-caldav.icloud.com/123/calendars/").href)
      .toBe("https://p12-caldav.icloud.com/123/calendars/");

    for(const href of [
      "http://caldav.icloud.com/123/",
      "https://caldav.icloud.com:444/123/",
      "https://evil.example/123/",
      "https://caldav.icloud.com.evil.example/123/",
      "https://user:pass@caldav.icloud.com/123/",
      "https://p12-caldav.icloud.com.evil.example/123/",
    ]){
      expect(()=>resolveAppleDavUrl(root,href)).toThrowError(expect.objectContaining({
        code:"CALDAV_DISCOVERY_FAILED",
      }));
    }
  });

  it("parses DAV discovery independent of namespace prefixes",()=>{
    const principal=parseCurrentUserPrincipal(fixture("principal.xml"));
    expect(principal).toBe("/123/principal/");

    const home=parseCalendarHomeSet(fixture("principal.xml"));
    expect(home).toBe("https://p12-caldav.icloud.com/123/calendars/");

    expect(parseCalendarCollections(fixture("calendar-home.xml"))).toEqual([
      {
        href:"/123/calendars/kairos/",
        name:"Kairos",
        writable:true,
      },
      {
        href:"/123/calendars/read-only/",
        name:"Read only",
        writable:false,
      },
    ]);
  });

  it("treats bind plus write-content as event-write access",()=>{
    const xml=`<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:response>
          <d:href>/123/calendars/kairos/</d:href>
          <d:propstat>
            <d:prop>
              <d:displayname>Kairos</d:displayname>
              <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
              <d:current-user-privilege-set>
                <d:privilege><d:read/></d:privilege>
                <d:privilege><d:bind/></d:privilege>
                <d:privilege><d:unbind/></d:privilege>
                <d:privilege><d:write-content/></d:privilege>
                <d:privilege><d:write-properties/></d:privilege>
              </d:current-user-privilege-set>
            </d:prop>
          </d:propstat>
        </d:response>
      </d:multistatus>`;
    expect(parseCalendarCollections(xml)).toEqual([{
      href:"/123/calendars/kairos/",
      name:"Kairos",
      writable:true,
    }]);
  });

  it("does not call a calendar writable when it cannot create event resources",()=>{
    const xml=`<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:response>
          <d:href>/123/calendars/read-only-ish/</d:href>
          <d:propstat>
            <d:prop>
              <d:displayname>Read only-ish</d:displayname>
              <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
              <d:current-user-privilege-set>
                <d:privilege><d:read/></d:privilege>
                <d:privilege><d:write-content/></d:privilege>
              </d:current-user-privilege-set>
            </d:prop>
          </d:propstat>
        </d:response>
      </d:multistatus>`;
    expect(parseCalendarCollections(xml)[0]).toMatchObject({writable:false});
  });

  it.each([
    "<!DOCTYPE foo [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><multistatus/>",
    "<multistatus><!ENTITY xxe 'boom'></multistatus>",
  ])("rejects dangerous XML declarations before parsing",xml=>{
    expect(()=>parseCurrentUserPrincipal(xml)).toThrowError(expect.objectContaining({
      code:"CALDAV_DISCOVERY_FAILED",
    }));
  });
});
