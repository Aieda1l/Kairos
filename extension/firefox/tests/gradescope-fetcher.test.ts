// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  discoverGradescopeCourses,
  fetchGradescopeAssignments,
} from "../src/gradescope/fetch";
import type {
  GradescopeDiscoverRequestV1,
  GradescopeSyncRequestV1,
} from "@/lib/extension-protocol/gradescope";

const requestId="11111111-1111-4111-8111-111111111111";
const accountHtml=fs.readFileSync(path.join(process.cwd(),"extension/firefox/tests/fixtures/gradescope-account-student.html"),"utf8");
const courseHtml=fs.readFileSync(path.join(process.cwd(),"extension/firefox/tests/fixtures/gradescope-course-student.html"),"utf8");
const malformedHtml=fs.readFileSync(path.join(process.cwd(),"extension/firefox/tests/fixtures/gradescope-course-malformed.html"),"utf8");

const discoverRequest:GradescopeDiscoverRequestV1={protocolVersion:1,requestId};
const syncRequest=(courseIds=["123"]):GradescopeSyncRequestV1=>({protocolVersion:1,requestId,courseIds});
const response=(body:string,status=200,url="https://www.gradescope.com/account")=>({
  ok:status>=200&&status<300,
  status,
  url,
  text:async()=>body,
}) as Response;

describe("Gradescope same-origin fetching",()=>{
  it("discovers courses from /account with the signed-in browser session",async()=>{
    const fetchImpl=vi.fn(async()=>response(accountHtml));
    const result=await discoverGradescopeCourses(discoverRequest,fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("/account",expect.objectContaining({
      credentials:"include",
      redirect:"follow",
    }));
    expect(result.courses.map(course=>course.courseId)).toEqual(["123","124"]);
    expect(result.requestId).toBe(requestId);
    expect(JSON.stringify(result)).not.toContain("<html");
  });

  it("maps login redirects and malformed authenticated pages without leaking HTML",async()=>{
    const signedOut=await discoverGradescopeCourses(
      discoverRequest,
      (async()=>response("<html>private login</html>",200,"https://www.gradescope.com/login")) as typeof fetch,
    );
    expect(signedOut.errorCode).toBe("GRADESCOPE_SIGNED_OUT");
    expect(JSON.stringify(signedOut)).not.toContain("private login");

    const malformed=await discoverGradescopeCourses(
      discoverRequest,
      (async()=>response("<html><body>private changed page</body></html>")) as typeof fetch,
    );
    expect(malformed.errorCode).toBe("GRADESCOPE_PARSE_ERROR");
    expect(JSON.stringify(malformed)).not.toContain("private changed page");
  });

  it("fetches only validated same-origin course paths and parses assignments",async()=>{
    const fetchImpl=vi.fn(async(input:RequestInfo|URL)=>response(
      courseHtml,
      200,
      new URL(String(input),"https://www.gradescope.com").href,
    ));
    const result=await fetchGradescopeAssignments(
      syncRequest(),
      fetchImpl as typeof fetch,
      ()=>new Date("2026-10-04T20:00:00.000Z"),
    );
    expect(fetchImpl).toHaveBeenCalledWith("/courses/123",expect.objectContaining({
      credentials:"include",
      redirect:"follow",
    }));
    expect(result.courses[0].assignments.some(a=>a.assignmentId==="457"&&a.gradeScore==="8.5")).toBe(true);
  });

  it("rejects unexpected final origins and reports safe HTTP diagnostics",async()=>{
    const otherOrigin=await fetchGradescopeAssignments(
      syncRequest(),
      (async()=>response(courseHtml,200,"https://evil.example/courses/123")) as typeof fetch,
      ()=>new Date("2026-10-04T20:00:00.000Z"),
    );
    expect(otherOrigin.courses[0].errorCode).toBe("GRADESCOPE_NETWORK_ERROR");

    const rateLimited=await fetchGradescopeAssignments(
      syncRequest(),
      (async()=>response("private rate limit",429,"https://www.gradescope.com/courses/123")) as typeof fetch,
      ()=>new Date("2026-10-04T20:00:00.000Z"),
    );
    expect(rateLimited.courses[0]).toMatchObject({
      errorCode:"GRADESCOPE_NETWORK_ERROR",
      diagnosticCode:"HTTP_429",
      httpStatus:429,
    });
    expect(JSON.stringify(rateLimited)).not.toContain("private rate limit");
  });

  it("distinguishes parser failure and course-not-found from network failures",async()=>{
    const malformed=await fetchGradescopeAssignments(
      syncRequest(),
      (async()=>response(malformedHtml,200,"https://www.gradescope.com/courses/123")) as typeof fetch,
      ()=>new Date("2026-10-04T20:00:00.000Z"),
    );
    expect(malformed.courses[0].errorCode).toBe("GRADESCOPE_PARSE_ERROR");

    const missing=await fetchGradescopeAssignments(
      syncRequest(),
      (async()=>response("",404,"https://www.gradescope.com/courses/123")) as typeof fetch,
      ()=>new Date("2026-10-04T20:00:00.000Z"),
    );
    expect(missing.courses[0].errorCode).toBe("GRADESCOPE_COURSE_UNAVAILABLE");
  });

  it("limits course concurrency to four and reports partial sync",async()=>{
    let active=0,maxActive=0;
    const fetchImpl=vi.fn(async(input:RequestInfo|URL)=>{
      const courseId=String(input).split("/").at(-1)!;
      active++;maxActive=Math.max(active,maxActive);
      await new Promise(resolve=>setTimeout(resolve,5));
      active--;
      if(courseId==="5")return response("private failure",503,`https://www.gradescope.com/courses/${courseId}`);
      return response(`<main id="course-show"><table><tbody><tr role="row"><th><button class="js-submitAssignment" data-assignment-id="${courseId}">HW ${courseId}</button></th><td>Submitted</td><td></td></tr></tbody></table></main>`,200,`https://www.gradescope.com/courses/${courseId}`);
    });
    const result=await fetchGradescopeAssignments(
      syncRequest(["1","2","3","4","5","6","7","8","9"]),
      fetchImpl as typeof fetch,
      ()=>new Date("2026-10-04T20:00:00.000Z"),
    );
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(result.courses.filter(course=>!course.errorCode)).toHaveLength(8);
    expect(result.errorCode).toBe("PARTIAL_SYNC");
  });
});
