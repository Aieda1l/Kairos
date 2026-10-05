import { z } from "zod";
import {
  gradescopeDiscoverRequestV1Schema,
  gradescopeSyncRequestV1Schema,
} from "@/lib/extension-protocol/gradescope";
import {
  discoverGradescopeCourses,
  fetchGradescopeAssignments,
} from "../gradescope/fetch";

const requestSchema=z.union([
  gradescopeDiscoverRequestV1Schema,
  gradescopeSyncRequestV1Schema,
]);

browser.runtime.onMessage.addListener((message)=>{
  const parsed=requestSchema.safeParse(message);
  if(!parsed.success)return undefined;
  return "courseIds" in parsed.data
    ? fetchGradescopeAssignments(parsed.data)
    : discoverGradescopeCourses(parsed.data);
});
