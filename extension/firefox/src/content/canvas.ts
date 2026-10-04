import { submissionSyncRequestV1Schema } from "@/lib/extension-protocol/submission-status";
import { fetchCanvasSubmissionStatuses } from "../canvas/fetch-statuses";

browser.runtime.onMessage.addListener((message)=>{
  const parsed=submissionSyncRequestV1Schema.safeParse(message);
  if(!parsed.success)return undefined;
  return fetchCanvasSubmissionStatuses(parsed.data);
});
