"use client";
import {syncAllRequestInit} from '@/lib/sync-all/client';
import type {SyncAllOptions} from '@/lib/sync-all/types';
import {getRecoveryNotice,recoveryFromResponse,RecoveryRequestError,type RecoveryNotice} from "@/lib/recovery/presentation";

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
    failureHttpStatuses: z.array(z.object({status: z.number().int().min(100).max(599), count: z.number().int().positive()}).strict()).default([]),
  })
  .strict();

type SyncPhase = "idle" | "syncing" | "success" | "partial" | "error";

type SubmissionStatusContextValue = SubmissionStatusSyncState & {
  automaticEnabled:boolean;
  enabled:boolean;
  recovery:RecoveryNotice|null;
  extensionChecked:boolean;
  phase: SyncPhase;
  extensionDetected: boolean;
  extensionVersion: string | null;
  canvasTabDetected: boolean | null;
  message: string;
  syncNow: (options?:SyncAllOptions) => Promise<void>;
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
  const safe=getRecoveryNotice(code);if(safe)return safe.message;
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

function messageForFailureDiagnostic(code: z.infer<typeof submissionFailureDiagnosticSchema>, httpStatus?: number): string {
  switch (code) {
    case "FETCH_EXCEPTION":
      return "Firefox could not complete the Canvas request. Reload the Canvas tab and try again.";
    case "HTTP_429":
      return "Canvas is rate-limiting submission status requests. Wait a minute and retry.";
    case "HTTP_5XX":
      return "Canvas returned a server error. Try again shortly.";
    case "HTTP_OTHER":
      return httpStatus ? `Canvas returned HTTP ${httpStatus}.` : "Canvas returned an unexpected HTTP response.";
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function startSyncRequest(runId?:string) {
  const response = await fetch("/api/sources/canvas/submission-status/start", {
    method: "POST",
    ...syncAllRequestInit({syncAllRunId:runId}),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new RecoveryRequestError(recoveryFromResponse(body,response),"Submission status sync could not start.");
  }
  return startResponseSchema.parse(body);
}

async function completeSyncRequest(input: {
  requestId: string;
  results: SubmissionStatusResultV1[];
  batchErrorCode: SubmissionSyncErrorCode | null;
}, options?: { deferCalendarSync?: boolean }) {
  const response = await fetch("/api/sources/canvas/submission-status/complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options?.deferCalendarSync ? { "x-kairos-calendar-sync": "defer" } : {}),
    },
    body: JSON.stringify(input),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new RecoveryRequestError(recoveryFromResponse(body,response),"Submission status could not be saved.");
  }
  return completeResponseSchema.parse(body);
}

export function SubmissionStatusProvider({
  enabled,
  automaticEnabled=true,
  initialSyncState,
  children,
}: {
  enabled: boolean;
  automaticEnabled?:boolean;
  initialSyncState: SubmissionStatusSyncState;
  children: ReactNode;
}) {
  const router = useRouter();
  const [syncState, setSyncState] = useState(initialSyncState);
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const [message, setMessage] = useState("");
  const [recovery,setRecovery]=useState<RecoveryNotice|null>(null);
  const [extensionChecked,setExtensionChecked]=useState(false);
  const blockedUntil=useRef(0);
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
        setExtensionChecked(true);
        setExtensionDetected(true);
        setExtensionVersion(info.extensionVersion);
        setCanvasTabDetected(info.canvasTabDetected);
        return info;
      })
      .catch((error: unknown) => {
        setExtensionChecked(true);
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

  const syncNow = useCallback(async (options?:SyncAllOptions) => {
    if (syncInFlightRef.current||Date.now()<blockedUntil.current) return;
    setRecovery(null);
    syncInFlightRef.current = true;
    setPhase("syncing");
    setMessage("");

    try {
      const started = await startSyncRequest(options?.syncAllRunId);
      const results: SubmissionStatusResultV1[] = [];
      let batchErrorCode: SubmissionSyncErrorCode | null = null;


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

            if (error.code === "EXTENSION_UNAVAILABLE") setExtensionDetected(false);
            if (error.code === "CANVAS_TAB_UNAVAILABLE") setCanvasTabDetected(false);
          } else {
            batchErrorCode = "INVALID_RESULT";

          }
        }
      }

      const completed = await completeSyncRequest({
        requestId: started.requestId,
        results,
        batchErrorCode,
      }, options);
      const nextState: SubmissionStatusSyncState = {
        lastAttemptedAt: completed.lastAttemptedAt,
        lastSuccessfulAt: completed.lastSuccessfulAt,
        lastErrorCode: completed.lastErrorCode,
        updatedCount: completed.updatedCount,
        failedCount: completed.failedCount,
      };
      setSyncState(nextState);
      const diagnostic=completed.failureDiagnostics[0]?.code;
      const notice=getRecoveryNotice(diagnostic==="HTTP_429"?diagnostic:completed.lastErrorCode,{key:"submission"});
      setRecovery(notice);
      if(notice?.retryAfterSeconds)blockedUntil.current=Date.now()+notice.retryAfterSeconds*1000;

      if (completed.lastErrorCode === "PARTIAL_SYNC") {
        setPhase("partial");
        setMessage(
          completed.updatedCount + " of " +
            (completed.updatedCount + completed.failedCount) +
            " submission statuses updated",
        );
      } else if (completed.lastErrorCode) {
        setPhase("error");
        setMessage((completed.failureDiagnostics[0] ? messageForFailureDiagnostic(completed.failureDiagnostics[0].code, completed.failureHttpStatuses[0]?.status) : messageForError(completed.lastErrorCode)));
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
      const notice=error instanceof RecoveryRequestError?error.notice:error instanceof ExtensionBridgeError?getRecoveryNotice(error.code):getRecoveryNotice('SERVICE_UNAVAILABLE');
      setRecovery(notice);
      if(notice?.retryAfterSeconds)blockedUntil.current=Date.now()+notice.retryAfterSeconds*1000;
      if(notice?.key==='SYNC_RECOVERY_REQUIRED')blockedUntil.current=Infinity;
      setMessage(notice?.message??'Submission status sync failed. Previously saved data was kept.');
    } finally {
      syncInFlightRef.current = false;
    }
  }, [getExtensionInfo, router, syncState.lastSuccessfulAt]);

  useEffect(() => {
    void getExtensionInfo().catch(() => undefined);
  }, [getExtensionInfo]);

  useEffect(() => {
    if (autoStartedRef.current || !enabled || !automaticEnabled) return;
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
  }, [enabled, automaticEnabled, syncNow, syncState.lastSuccessfulAt]);

  return (
    <SubmissionStatusContext.Provider
      value={{
        ...syncState,
        automaticEnabled,enabled,recovery,extensionChecked,
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
