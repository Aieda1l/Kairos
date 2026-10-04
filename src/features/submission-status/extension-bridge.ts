"use client";

import {
  PROTOCOL_VERSION,
  kairosBridgeResponseV1Schema,
  submissionSyncRequestV1Schema,
  type CanvasBatchResultV1,
  type KairosBridgeRequestV1,
  type KairosBridgeResponseV1,
  type SubmissionSyncErrorCode,
  type SubmissionSyncRequestV1,
} from "@/lib/extension-protocol/submission-status";

const DEFAULT_PING_TIMEOUT_MS = 750;
const DEFAULT_BATCH_TIMEOUT_MS = 30_000;

export type ExtensionPingResult = {
  extensionVersion: string;
  canvasTabDetected: boolean;
};

export class ExtensionBridgeError extends Error {
  constructor(
    public readonly code: SubmissionSyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExtensionBridgeError";
  }
}

function bridgeRoundTrip(
  request: KairosBridgeRequestV1,
  timeoutCode: SubmissionSyncErrorCode,
  timeoutMessage: string,
  timeoutMs: number,
): Promise<KairosBridgeResponseV1> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
    };

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const parsed = kairosBridgeResponseV1Schema.safeParse(event.data);
      if (!parsed.success || parsed.data.requestId !== request.requestId) return;

      finish(() => {
        if (parsed.data.type === "ERROR") {
          reject(new ExtensionBridgeError(parsed.data.errorCode, parsed.data.message));
          return;
        }
        resolve(parsed.data);
      });
    };

    const timeout = window.setTimeout(() => {
      finish(() => reject(new ExtensionBridgeError(timeoutCode, timeoutMessage)));
    }, timeoutMs);

    window.addEventListener("message", onMessage);
    try {
      window.postMessage(request, window.location.origin);
    } catch {
      finish(() =>
        reject(
          new ExtensionBridgeError(
            "EXTENSION_UNAVAILABLE",
            "Firefox extension not detected",
          ),
        ),
      );
    }
  });
}

export async function pingKairosExtension(
  timeoutMs = DEFAULT_PING_TIMEOUT_MS,
): Promise<ExtensionPingResult> {
  const requestId = crypto.randomUUID();
  const response = await bridgeRoundTrip(
    {
      source: "kairos-page",
      type: "PING",
      protocolVersion: PROTOCOL_VERSION,
      requestId,
    },
    "EXTENSION_UNAVAILABLE",
    "Firefox extension not detected",
    timeoutMs,
  );

  if (response.type !== "PONG") {
    throw new ExtensionBridgeError("INVALID_RESULT", "Firefox extension returned an invalid response.");
  }

  return {
    extensionVersion: response.extensionVersion,
    canvasTabDetected: response.canvasTabDetected,
  };
}

export async function syncExtensionBatch(
  input: SubmissionSyncRequestV1,
  timeoutMs = DEFAULT_BATCH_TIMEOUT_MS,
): Promise<CanvasBatchResultV1> {
  const payload = submissionSyncRequestV1Schema.parse(input);
  const response = await bridgeRoundTrip(
    {
      source: "kairos-page",
      type: "SYNC_SUBMISSION_STATUS",
      protocolVersion: PROTOCOL_VERSION,
      requestId: payload.requestId,
      payload,
    },
    "EXTENSION_TIMEOUT",
    "Firefox extension timed out.",
    timeoutMs,
  );

  if (
    response.type !== "SYNC_SUBMISSION_STATUS_RESULT" ||
    response.payload.requestId !== payload.requestId
  ) {
    throw new ExtensionBridgeError("INVALID_RESULT", "Firefox extension returned an invalid response.");
  }

  return response.payload;
}
