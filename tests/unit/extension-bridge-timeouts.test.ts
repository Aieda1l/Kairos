// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pingKairosExtension,
  syncExtensionBatch,
} from "@/features/submission-status/extension-bridge";

function track<T>(promise:Promise<T>){
  let state:"pending"|"resolved"|"rejected"="pending";
  promise.then(
    ()=>{state="resolved";},
    ()=>{state="rejected";},
  );
  return ()=>state;
}

beforeEach(()=>{
  vi.useFakeTimers();
});

afterEach(()=>{
  vi.useRealTimers();
});

describe("extension bridge default timeouts",()=>{
  it("times out extension detection after 750 ms by default",async()=>{
    const promise=pingKairosExtension();
    const state=track(promise);

    await vi.advanceTimersByTimeAsync(749);
    expect(state()).toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    expect(state()).toBe("rejected");
    await expect(promise).rejects.toMatchObject({code:"EXTENSION_UNAVAILABLE"});
  });

  it("times out a submission batch after 30 seconds by default",async()=>{
    const promise=syncExtensionBatch({
      protocolVersion:1,
      requestId:"11111111-1111-4111-8111-111111111111",
      assignments:[{
        assignmentLocalId:"local-1",
        courseId:"999",
        assignmentId:"4242",
      }],
    });
    const state=track(promise);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(state()).toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    expect(state()).toBe("rejected");
    await expect(promise).rejects.toMatchObject({code:"EXTENSION_TIMEOUT"});
  });
});
