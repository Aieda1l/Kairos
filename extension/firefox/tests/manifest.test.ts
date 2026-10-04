import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Firefox manifest",()=>{
  it("requests only narrow Kairos and Canvas permissions",()=>{
    const manifest=JSON.parse(fs.readFileSync(path.join(process.cwd(),"extension/firefox/manifest.json"),"utf8")) as {
      permissions?:string[];
      host_permissions?:string[];
      content_scripts?:Array<{matches?:string[]}>;
      version?:string;
    };
    expect(manifest.version).toBe("0.2.4");
    expect(manifest.permissions??[]).toEqual(expect.arrayContaining(["tabs"]));
    expect(manifest.permissions??[]).not.toEqual(expect.arrayContaining(["cookies","history","downloads","<all_urls>"]));
    expect(manifest.host_permissions).toEqual([
      "https://canvas.uw.edu/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ]);
    expect(JSON.stringify(manifest)).not.toContain("<all_urls>");
  });
});
