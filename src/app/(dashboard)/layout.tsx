import { connection as waitForRequest } from "next/server";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { SubmissionStatusProvider } from "@/features/submission-status/submission-status-provider";
import { getDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { AssignmentRepository } from "@/lib/db/repositories/assignments";
import { SourceConnectionRepository } from "@/lib/db/repositories/source-connections";
import { SubmissionStatusRepository } from "@/lib/db/repositories/submission-status";
import { parseCanvasAssignmentLocator } from "@/lib/submission-status/canvas-locator";
import type { SubmissionStatusSyncState } from "@/lib/submission-status/types";

const emptySyncState: SubmissionStatusSyncState = {
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

  const connection = new SourceConnectionRepository(db).getByKind("canvas");
  const assignments = new AssignmentRepository(db).list({ source: "canvas" });
  const hasEligibleAssignment = assignments.some(
    (assignment) => parseCanvasAssignmentLocator(assignment) !== null,
  );
  const syncState = connection
    ? new SubmissionStatusRepository(db).getSyncState(connection.id)
    : emptySyncState;

  return (
    <ThemeProvider>
      <SubmissionStatusProvider
        enabled={Boolean(connection && connection.enabled && hasEligibleAssignment)}
        initialSyncState={syncState}
      >
        <AppShell>{children}</AppShell>
      </SubmissionStatusProvider>
    </ThemeProvider>
  );
}
