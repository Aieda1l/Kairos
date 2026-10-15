import {vi} from "vitest";
import * as bindings from "@/lib/platform/abuse-runtime";
import type {D1DatabaseLike} from "@/lib/db/d1/types";

/** Supply server bindings in hosted service fixtures; admissions stay real D1. */
export function installProviderRuntime(db:D1DatabaseLike){
  return vi.spyOn(bindings,"getAbuseRuntime").mockResolvedValue({
    db,hmacKey:new Uint8Array(32).fill(7),appOrigin:"http://127.0.0.1:3000",
    hostname:"127.0.0.1",trustedIngress:"loopback",turnstileSecret:"synthetic-secret",fetchImpl:fetch,
  });
}
