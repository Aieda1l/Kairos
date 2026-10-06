import {expect,it} from "vitest";import {redactError} from "@/lib/security/redact";
it("does not echo credential URLs from errors",()=>{const secret="https://canvas.example.edu/feeds/calendars/private-secret-token.ics";const rendered=JSON.stringify({code:"NETWORK_ERROR",message:redactError(new Error(`fetch failed ${secret}`),[secret])});expect(rendered).not.toContain("private-secret-token");});

it("does not echo Ed bearer tokens from errors",()=>{
  const token="fixture-ed-token-never-echo";
  const rendered=JSON.stringify({code:"ED_NETWORK_ERROR",message:redactError(new Error(`request failed Bearer ${token}`),[token])});
  expect(rendered).not.toContain(token);
});


it("does not echo calendar oauth or CalDAV secrets from errors",()=>{
  const secrets=[
    "fixture-google-refresh-never-echo",
    "fixture-oauth-code-never-echo",
    "fixture-pkce-verifier-never-echo",
    "fixture-icloud-app-password-never-echo",
  ];
  const rendered=JSON.stringify({
    code:"CALENDAR_AUTH_EXPIRED",
    message:redactError(new Error(`calendar request failed ${secrets.join(" ")}`),secrets),
  });
  for(const secret of secrets)expect(rendered).not.toContain(secret);
});

import fs from "node:fs";
import path from "node:path";

it("keeps better-sqlite3 out of production source modules",()=>{
  const root=path.join(process.cwd(),"src");
  const offenders:string[]=[];
  const stack=[root];

  while(stack.length){
    const current=stack.pop()!;
    for(const entry of fs.readdirSync(current,{withFileTypes:true})){
      const full=path.join(current,entry.name);
      if(entry.isDirectory()){
        stack.push(full);
        continue;
      }
      if(!/\.(ts|tsx)$/.test(entry.name))continue;
      if(fs.readFileSync(full,"utf8").includes("better-sqlite3")){
        offenders.push(path.relative(process.cwd(),full));
      }
    }
  }

  expect(offenders).toEqual([]);
});
