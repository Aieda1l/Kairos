import { afterEach, describe, expect, it } from "vitest";
import {
  AuthenticationRequiredError,
  requireUserScope,
} from "@/lib/auth/user-scope";

afterEach(()=>{
  delete process.env.E2E_FIXTURES;
  delete process.env.KAIROS_E2E_USER_ID;
});

describe("requireUserScope",()=>{
  it("derives scope from the durable authenticated user id",async()=>{
    const result=await requireUserScope(async()=>({
      user:{id:"alice"},
    }));

    expect(result).toEqual({userId:"alice"});
  });

  it("uses a fixed server-configured user in E2E fixture mode",async()=>{
    process.env.E2E_FIXTURES="1";
    process.env.KAIROS_E2E_USER_ID="kairos-e2e-user";

    await expect(requireUserScope()).resolves.toEqual({userId:"kairos-e2e-user"});
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
