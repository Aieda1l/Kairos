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
      icons?:Record<string,string>;
      action?:{default_icon?:string|Record<string,string>};
    };
    expect(manifest.version).toBe("0.2.6");
    expect(manifest.icons).toEqual({"48":"icon.svg","96":"icon.svg"});
    expect(manifest.action?.default_icon).toBe("icon.svg");
    expect(fs.existsSync(path.join(process.cwd(),"extension/firefox/icon.svg"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(),"src/app/icon.svg"))).toBe(true);
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
