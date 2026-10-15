import {describe,expect,it,vi} from "vitest";
import {authDiagnostics} from "@/lib/auth/diagnostics";

describe("hosted sign-in diagnostics",()=>{
  it("logs only a fixed category when Microsoft rejects its client secret",()=>{
    const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
    try{
      const error=Object.assign(new Error(
        "OAuth Provider returned an error: invalid_client. Secret and email fake-sensitive-user@example.invalid",
      ),{
        type:"OAuthCallbackError",
        cause:{error_description:"secret and private token"},
      });
      authDiagnostics.error(error);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(JSON.parse(warning.mock.calls[0][0] as string)).toMatchObject({
        event:"kairos.operation",action:"auth.callback",code:"AUTH_FAILED",result:"error",
      });
      const log=JSON.stringify(warning.mock.calls);
      expect(log).not.toContain("fake-sensitive-user");
      expect(log).not.toContain("private token");
      expect(log).not.toContain("Secret and email");
    }finally{
      warning.mockRestore();
    }
  });

  it("drops unexpected provider metadata and all other Auth.js debug events",()=>{
    const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
    try{
      authDiagnostics.debug("authorization result",{
        tokens:{access_token:"private-token"},email:"private-email",
      });
      authDiagnostics.debug("OAuthCallbackError",{
        providerId:"microsoft-entra-id",
        error:"access_denied",
        error_description:"private-email secret password",
        code:"private-code",
      });
      authDiagnostics.debug("OAuthCallbackError",{
        providerId:"unknown-private-id",error:"surprise-sensitive-payload",
      });
      expect(warning).toHaveBeenCalledTimes(2);
      expect(JSON.parse(warning.mock.calls[0][0] as string)).toMatchObject({
        event:"kairos.operation",provider:"microsoft",code:"AUTH_REJECTED",result:"rejected",
      });
      expect(JSON.parse(warning.mock.calls[1][0] as string)).not.toHaveProperty("provider");
      const log=JSON.stringify(warning.mock.calls);
      for(const sensitive of ["private-token","private-email","private-code","password","unknown-private-id"]){
        expect(log).not.toContain(sensitive);
      }
    }finally{
      warning.mockRestore();
    }
  });
});
