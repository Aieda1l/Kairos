import { connection as waitForRequest } from "next/server";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { SubmissionStatusProvider } from "@/features/submission-status/submission-status-provider";
import { GradescopeProvider } from "@/features/gradescope/gradescope-provider";
import { EdProvider } from "@/features/ed/ed-provider";
import { CalendarSyncProvider } from "@/features/calendars/calendar-provider";
import { D1AssignmentRepository } from "@/lib/db/d1/repositories/assignments";
import { D1SourceConnectionRepository } from "@/lib/db/d1/repositories/source-connections";
import { D1CalendarConnectionRepository } from "@/lib/db/d1/repositories/calendar-connections";
import { D1SourceCourseRepository } from "@/lib/db/d1/repositories/source-courses";
import { D1SubmissionStatusRepository } from "@/lib/db/d1/repositories/submission-status";
import { getSourceRuntimeContext } from "@/lib/platform/source-runtime";
import { parseCanvasAssignmentLocator } from "@/lib/submission-status/canvas-locator";
import type { SubmissionStatusSyncState } from "@/lib/submission-status/types";
import type { GradescopeSyncErrorCode } from "@/lib/extension-protocol/gradescope";

const emptyCanvasSyncState: SubmissionStatusSyncState = {
  lastAttemptedAt: null,
  lastSuccessfulAt: null,
  lastErrorCode: null,
  updatedCount: 0,
  failedCount: 0,
};

const emptyEdSyncState: SubmissionStatusSyncState<string> = {
  lastAttemptedAt: null,
  lastSuccessfulAt: null,
  lastErrorCode: null,
  updatedCount: 0,
  failedCount: 0,
};

const emptyGradescopeSyncState: SubmissionStatusSyncState<GradescopeSyncErrorCode> = {
  lastAttemptedAt: null,
  lastSuccessfulAt: null,
  lastErrorCode: null,
  updatedCount: 0,
  failedCount: 0,
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await waitForRequest();
  const {db,scope}=await getSourceRuntimeContext();

  const connections=new D1SourceConnectionRepository(db,scope);
  const statuses=new D1SubmissionStatusRepository(db,scope);
  const assignments=new D1AssignmentRepository(db,scope);
  const courses=new D1SourceCourseRepository(db,scope);

  const [
    calendarConnections,
    canvasConnection,
    canvasAssignments,
    gradescopeConnection,
    edConnection,
  ]=await Promise.all([
    new D1CalendarConnectionRepository(db,scope).list(),
    connections.getByKind("canvas"),
    assignments.list({source:"canvas"}),
    connections.getByKind("gradescope"),
    connections.getByKind("ed"),
  ]);

  const hasEligibleCanvasAssignment=canvasAssignments.some(
    assignment=>parseCanvasAssignmentLocator(assignment)!==null,
  );

  const [
    canvasSyncState,
    gradescopeCourses,
    gradescopeSyncState,
    edCourses,
    edSyncState,
  ]=await Promise.all([
    canvasConnection
      ?statuses.getSyncState(canvasConnection.id)
      :Promise.resolve(emptyCanvasSyncState),
    gradescopeConnection
      ?courses.list(gradescopeConnection.id)
      :Promise.resolve([]),
    gradescopeConnection
      ?statuses.getSyncState<GradescopeSyncErrorCode>(gradescopeConnection.id)
      :Promise.resolve(emptyGradescopeSyncState),
    edConnection
      ?courses.list(edConnection.id)
      :Promise.resolve([]),
    edConnection
      ?statuses.getSyncState<string>(edConnection.id)
      :Promise.resolve(emptyEdSyncState),
  ]);

  return (
    <ThemeProvider>
      <CalendarSyncProvider initialConnections={calendarConnections}>
        <EdProvider connection={edConnection} initialCourses={edCourses} initialSyncState={edSyncState}>
          <GradescopeProvider
            connection={gradescopeConnection}
            initialCourses={gradescopeCourses}
            initialSyncState={gradescopeSyncState}
          >
            <SubmissionStatusProvider
              enabled={Boolean(canvasConnection && canvasConnection.enabled && hasEligibleCanvasAssignment)}
              initialSyncState={canvasSyncState}
            >
              <AppShell>{children}</AppShell>
            </SubmissionStatusProvider>
          </GradescopeProvider>
        </EdProvider>
      </CalendarSyncProvider>
    </ThemeProvider>
  );
}
