import { describe, expect, it } from "vitest";
import {
  AuthenticationRequiredError,
  requireUserScope,
} from "@/lib/auth/user-scope";

describe("requireUserScope",()=>{
  it("derives scope from the durable authenticated user id",async()=>{
    const result=await requireUserScope(async()=>({
      user:{id:"alice"},
    }));

    expect(result).toEqual({userId:"alice"});
  });

  it("rejects a missing session with a stable auth error",async()=>{
    await expect(requireUserScope(async()=>null)).rejects.toMatchObject({
      name:"AuthenticationRequiredError",
      code:"AUTH_REQUIRED",
    });
    await expect(requireUserScope(async()=>null)).rejects.toBeInstanceOf(AuthenticationRequiredError);
  });

  it("rejects sessions that do not expose a durable user id",async()=>{
    await expect(requireUserScope(async()=>({
      user:{name:"Alice"},
    }))).rejects.toMatchObject({code:"AUTH_REQUIRED"});
  });
});
