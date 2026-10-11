import "server-only";
import {validateCanvasFeedUrl} from "./validate-url";

const FIXTURE=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Kairos E2E//EN\r\nBEGIN:VEVENT\r\nUID:event-assignment-4242\r\nDTSTAMP:20261003T200000Z\r\nDTSTART:20261009T065900Z\r\nDTEND:20261009T065900Z\r\nSUMMARY:Fixture Homework [CSE 999]\r\nURL:https://canvas.uw.edu/calendar?include_contexts=course_999#assignment_4242\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

export function canvasFixtureResponse():Response{
  return new Response(FIXTURE,{headers:{"content-type":"text/calendar; charset=utf-8","cache-control":"no-store"}});
}

export function getCanvasRouteFetch():typeof fetch{
  if(process.env.E2E_FIXTURES!=="1")return fetch;
  // Test transport maps one canonical UW fixture; production validation is unchanged.
  return async input=>{
    const raw=typeof input==="string"?input:input instanceof URL?input.href:input.url;
    const url=validateCanvasFeedUrl(raw);
    if(url.pathname!=="/feeds/calendars/kairos-e2e-fixture.ics"){
      throw new Error("Canvas fixture transport rejected a nonfixture path.");
    }
    return canvasFixtureResponse();
  };
}
