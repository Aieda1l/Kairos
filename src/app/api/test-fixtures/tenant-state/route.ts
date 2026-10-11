import {getAuthenticatedE2EFixtureRuntime} from "@/lib/testing/e2e-runtime";

export async function POST(){
  const runtime=await getAuthenticatedE2EFixtureRuntime();
  if(!runtime)return new Response("Not found",{status:404});

  const alice=runtime.userId==="alice";
  const name=alice?"Alice":"Bob";
  const sourceKind=alice?"canvas":"ed";
  const sourceId=`${runtime.userId}-source`;
  const assignmentId=`${runtime.userId}-assignment`;
  const calendarId=`${runtime.userId}-calendar`;
  const assignmentTitle=`${name} Hosted Assignment`;
  const calendarAccount=`${runtime.userId}@example.invalid`;
  const now="2026-10-07T08:00:00.000Z";

  await runtime.db.prepare(`
    INSERT INTO source_connections(
      user_id,id,kind,label,enabled,last_sync_status,created_at,updated_at
    ) VALUES (?,?,?,?,1,'never',?,?)
  `).bind(
    runtime.userId,sourceId,sourceKind,`${name} ${sourceKind}`,now,now,
  ).run();

  await runtime.db.prepare(`
    INSERT INTO assignments(
      user_id,id,source_connection_id,source_kind,external_id,course_id,course_name,title,
      release_at,due_at,late_due_at,status,source_status_text,grade_score,grade_max,grade_display,
      source_url,source_updated_at,first_seen_at,last_seen_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    runtime.userId,
    assignmentId,
    sourceId,
    sourceKind,
    `${runtime.userId}-external-assignment`,
    alice?"101":"202",
    `${name} Course`,
    assignmentTitle,
    "2026-10-01T08:00:00.000Z",
    "2026-10-12T08:00:00.000Z",
    null,
    "pending",
    null,
    null,
    null,
    null,
    alice?"https://canvas.uw.edu/courses/101/assignments/1001":null,
    now,
    now,
    now,
    now,
    now,
  ).run();

  await runtime.db.prepare(`
    INSERT INTO calendar_connections(
      user_id,id,provider,label,account_label,remote_calendar_id,remote_calendar_name,
      enabled,last_sync_status,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,1,'never',?,?)
  `).bind(
    runtime.userId,
    calendarId,
    "caldav",
    "Apple iCloud Calendar",
    calendarAccount,
    `${runtime.userId}-remote-calendar`,
    `${name} Calendar`,
    now,
    now,
  ).run();

  return Response.json({
    sourceId,
    assignmentId,
    calendarId,
    assignmentTitle,
    calendarAccount,
  });
}
