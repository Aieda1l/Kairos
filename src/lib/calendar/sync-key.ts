import "server-only";
import {createHash} from "node:crypto";

export function createCalendarSyncKey(connectionId:string,assignmentId:string):string{
  return createHash("sha256").update(connectionId).update("\0").update(assignmentId).digest("hex");
}
