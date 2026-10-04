"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  PROTOCOL_VERSION,
  canvasAssignmentLocatorSchema,
  submissionFailureDiagnosticSchema,
  submissionStatusResultV1Schema,
  submissionSyncErrorCodeSchema,
  type SubmissionStatusResultV1,
  type SubmissionSyncErrorCode,
} from "@/lib/extension-protocol/submission-status";
import type { SubmissionStatusSyncState } from "@/lib/submission-status/types";
import {
  ExtensionBridgeError,
  pingKairosExtension,
  syncExtensionBatch,
  type ExtensionPingResult,
} from "./extension-bridge";

const STALE_AFTER_MS = 15 * 60 * 1000;

const startResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    assignments: z.array(canvasAssignmentLocatorSchema),
    maxBatchSize: z.literal(100),
  })
  .strict();

const completeResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    updatedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    ignoredStale: z.number().int().nonnegative(),
    lastAttemptedAt: z.string().datetime().nullable(),
    lastSuccessfulAt: z.string().datetime().nullable(),
    lastErrorCode: submissionSyncErrorCodeSchema.nullable(),
    failureDiagnostics: z.array(z.object({code: submissionFailureDiagnosticSchema, count: z.number().int().positive()}).strict()).default([]),
  })
  .strict();

type SyncPhase = "idle" | "syncing" | "success" | "partial" | "error";

type SubmissionStatusContextValue = SubmissionStatusSyncState & {
  phase: SyncPhase;
  extensionDetected: boolean;
  extensionVersion: string | null;
  canvasTabDetected: boolean | null;
  message: string;
  syncNow: () => Promise<void>;
};

const SubmissionStatusContext = createContext<SubmissionStatusContextValue | null>(null);

export function isSubmissionStatusStale(
  lastSuccessfulAt: string | null,
  now = new Date(),
): boolean {
  if (!lastSuccessfulAt) return true;
  const timestamp = Date.parse(lastSuccessfulAt);
  if (!Number.isFinite(timestamp)) return true;
  return now.getTime() - timestamp >= STALE_AFTER_MS;
}

function messageForError(code: SubmissionSyncErrorCode | null): string {
  switch (code) {
    case "EXTENSION_UNAVAILABLE":
      return "Firefox extension not detected";
    case "EXTENSION_TIMEOUT":
      return "Firefox extension timed out.";
    case "CANVAS_TAB_UNAVAILABLE":
      return "Open Canvas in Firefox, then try again.";
    case "CANVAS_SIGNED_OUT":
      return "Sign in to Canvas, then retry.";
    case "CANVAS_NETWORK_ERROR":
      return "Canvas could not be reached. Try again.";
    case "UNRECOGNIZED_STATUS":
      return "Canvas submission status could not be recognized.";
    case "INVALID_RESULT":
      return "Submission status returned an invalid result.";
    case "PARTIAL_SYNC":
      return "Some submission statuses could not be updated.";
    default:
      return "";
  }
}

function messageForFailureDiagnostic(code: z.infer<typeof submissionFailureDiagnosticSchema>): string {
  switch (code) {
    case "FETCH_EXCEPTION":
      return "Firefox could not complete the Canvas request. Reload the Canvas tab and try again.";
    case "HTTP_429":
      return "Canvas is rate-limiting submission status requests. Wait a minute and retry.";
    case "HTTP_5XX":
      return "Canvas returned a server error. Try again shortly.";
    case "HTTP_OTHER":
      return "Canvas returned an unexpected HTTP response.";
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function startSyncRequest() {
  const response = await fetch("/api/sources/canvas/submission-status/start", {
    method: "POST",
  });
  const body = await readJson(response);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : "Submission status sync could not start.";
    throw new Error(message);
  }
  return startResponseSchema.parse(body);
}

async function completeSyncRequest(input: {
  requestId: string;
  results: SubmissionStatusResultV1[];
  batchErrorCode: SubmissionSyncErrorCode | null;
}) {
  const response = await fetch("/api/sources/canvas/submission-status/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readJson(response);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : "Submission status could not be saved.";
    throw new Error(message);
  }
  return completeResponseSchema.parse(body);
}

export function SubmissionStatusProvider({
  enabled,
  initialSyncState,
  children,
}: {
  enabled: boolean;
  initialSyncState: SubmissionStatusSyncState;
  children: ReactNode;
}) {
  const router = useRouter();
  const [syncState, setSyncState] = useState(initialSyncState);
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [message, setMessage] = useState("");
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null);
  const [canvasTabDetected, setCanvasTabDetected] = useState<boolean | null>(null);
  const pingPromiseRef = useRef<Promise<ExtensionPingResult> | null>(null);
  const autoStartedRef = useRef(false);
  const syncInFlightRef = useRef(false);

  const getExtensionInfo = useCallback(() => {
    if (pingPromiseRef.current) return pingPromiseRef.current;

    const promise = pingKairosExtension()
      .then((info) => {
        setExtensionDetected(true);
        setExtensionVersion(info.extensionVersion);
        setCanvasTabDetected(info.canvasTabDetected);
        return info;
      })
      .catch((error: unknown) => {
        setExtensionDetected(false);
        setExtensionVersion(null);
        setCanvasTabDetected(null);
        if (error instanceof ExtensionBridgeError) {
          setMessage(error.message);
          throw error;
        }
        const unavailable = new ExtensionBridgeError(
          "EXTENSION_UNAVAILABLE",
          "Firefox extension not detected",
        );
        setMessage(unavailable.message);
        throw unavailable;
      });

    pingPromiseRef.current = promise;
    const clear = () => {
      if (pingPromiseRef.current === promise) pingPromiseRef.current = null;
    };
    void promise.then(clear, clear);
    return promise;
  }, []);

  const syncNow = useCallback(async () => {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    setPhase("syncing");
    setMessage("");

    try {
      const started = await startSyncRequest();
      const results: SubmissionStatusResultV1[] = [];
      let batchErrorCode: SubmissionSyncErrorCode | null = null;
      let bridgeFailureMessage = "";

      if (started.assignments.length > 0) {
        try {
          const extension = await getExtensionInfo();
          if (!extension.canvasTabDetected) {
            throw new ExtensionBridgeError(
              "CANVAS_TAB_UNAVAILABLE",
              "Open Canvas in Firefox, then try again.",
            );
          }

          for (let offset = 0; offset < started.assignments.length; offset += started.maxBatchSize) {
            const assignments = started.assignments.slice(offset, offset + started.maxBatchSize);
            const batch = await syncExtensionBatch({
              protocolVersion: PROTOCOL_VERSION,
              requestId: started.requestId,
              assignments,
            });
            for (const result of batch.results) {
              results.push(submissionStatusResultV1Schema.parse(result));
            }
          }
        } catch (error: unknown) {
          if (error instanceof ExtensionBridgeError) {
            batchErrorCode = error.code;
            bridgeFailureMessage = error.message;
            if (error.code === "EXTENSION_UNAVAILABLE") setExtensionDetected(false);
            if (error.code === "CANVAS_TAB_UNAVAILABLE") setCanvasTabDetected(false);
          } else {
            batchErrorCode = "INVALID_RESULT";
            bridgeFailureMessage = messageForError(batchErrorCode);
          }
        }
      }

      const completed = await completeSyncRequest({
        requestId: started.requestId,
        results,
        batchErrorCode,
      });
      const nextState: SubmissionStatusSyncState = {
        lastAttemptedAt: completed.lastAttemptedAt,
        lastSuccessfulAt: completed.lastSuccessfulAt,
        lastErrorCode: completed.lastErrorCode,
        updatedCount: completed.updatedCount,
        failedCount: completed.failedCount,
      };
      setSyncState(nextState);

      if (completed.lastErrorCode === "PARTIAL_SYNC") {
        setPhase("partial");
        setMessage(
          completed.updatedCount + " of " +
            (completed.updatedCount + completed.failedCount) +
            " submission statuses updated",
        );
      } else if (completed.lastErrorCode) {
        setPhase("error");
        setMessage(bridgeFailureMessage || (completed.failureDiagnostics[0] ? messageForFailureDiagnostic(completed.failureDiagnostics[0].code) : messageForError(completed.lastErrorCode)));
      } else {
        setPhase("success");
        setMessage("");
      }

      if (
        completed.lastSuccessfulAt &&
        completed.lastSuccessfulAt !== syncState.lastSuccessfulAt
      ) {
        router.refresh();
      }
    } catch (error: unknown) {
      setPhase("error");
      if (error instanceof ExtensionBridgeError) {
        setMessage(error.message);
      } else if (error instanceof Error) {
        setMessage(error.message);
      } else {
        setMessage("Submission status sync failed.");
      }
    } finally {
      syncInFlightRef.current = false;
    }
  }, [getExtensionInfo, router, syncState.lastSuccessfulAt]);

  useEffect(() => {
    void getExtensionInfo().catch(() => undefined);
  }, [getExtensionInfo]);

  useEffect(() => {
    if (autoStartedRef.current || !enabled) return;
    if (!isSubmissionStatusStale(syncState.lastSuccessfulAt)) {
      autoStartedRef.current = true;
      return;
    }

    const timeout = window.setTimeout(() => {
      if (autoStartedRef.current) return;
      autoStartedRef.current = true;
      void syncNow();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [enabled, syncNow, syncState.lastSuccessfulAt]);

  return (
    <SubmissionStatusContext.Provider
      value={{
        ...syncState,
        phase,
        extensionDetected,
        extensionVersion,
        canvasTabDetected,
        message,
        syncNow,
      }}
    >
      {children}
    </SubmissionStatusContext.Provider>
  );
}

export function useSubmissionStatusSync(): SubmissionStatusContextValue {
  const value = useContext(SubmissionStatusContext);
  if (!value) {
    throw new Error("useSubmissionStatusSync must be used within SubmissionStatusProvider.");
  }
  return value;
}
