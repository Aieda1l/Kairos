import { connection as waitForRequest } from "next/server";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { SubmissionStatusProvider } from "@/features/submission-status/submission-status-provider";
import { GradescopeProvider } from "@/features/gradescope/gradescope-provider";
import { getDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { AssignmentRepository } from "@/lib/db/repositories/assignments";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SourceCourseRepository } from "@/lib/db/repositories/source-courses";
import { SubmissionStatusRepository } from "@/lib/db/repositories/submission-status";
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

const emptyGradescopeSyncState: SubmissionStatusSyncState<GradescopeSyncErrorCode> = {
  lastAttemptedAt: null,
  lastSuccessfulAt: null,
  lastErrorCode: null,
  updatedCount: 0,
  failedCount: 0,
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await waitForRequest();
  const db = getDatabase();
  migrate(db);

  const connections = new SourceConnectionRepository(db);
  const statuses = new SubmissionStatusRepository(db);

  const canvasConnection = connections.getByKind("canvas");
  const canvasAssignments = new AssignmentRepository(db).list({ source: "canvas" });
  const hasEligibleCanvasAssignment = canvasAssignments.some(
    (assignment) => parseCanvasAssignmentLocator(assignment) !== null,
  );
  const canvasSyncState = canvasConnection
    ? statuses.getSyncState(canvasConnection.id)
    : emptyCanvasSyncState;

  const gradescopeConnection = connections.getByKind("gradescope");
  const gradescopeCourses = gradescopeConnection
    ? new SourceCourseRepository(db).list(gradescopeConnection.id)
    : [];
  const gradescopeSyncState = gradescopeConnection
    ? statuses.getSyncState<GradescopeSyncErrorCode>(gradescopeConnection.id)
    : emptyGradescopeSyncState;

  return (
    <ThemeProvider>
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
    </ThemeProvider>
  );
}
