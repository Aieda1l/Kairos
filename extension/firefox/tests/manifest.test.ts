import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Firefox manifest",()=>{
  it("requests only narrow Kairos, Canvas, and Gradescope permissions",()=>{
    const manifest=JSON.parse(fs.readFileSync(path.join(process.cwd(),"extension/firefox/manifest.json"),"utf8")) as {
      permissions?:string[];
      host_permissions?:string[];
      content_scripts?:Array<{matches?:string[];js?:string[]}>;
      version?:string;
      icons?:Record<string,string>;
      action?:{default_icon?:string|Record<string,string>};
    };
    expect(manifest.version).toBe("0.3.0");
    expect(manifest.icons).toEqual({"48":"icon48.png","96":"icon96.png"});
    expect(manifest.action?.default_icon).toEqual({"48":"icon48.png","96":"icon96.png"});
    expect(manifest.permissions??[]).toEqual(expect.arrayContaining(["tabs"]));
    expect(manifest.permissions??[]).not.toEqual(expect.arrayContaining(["cookies","history","downloads","webRequest","<all_urls>"]));
    expect(manifest.host_permissions).toEqual([
      "https://canvas.uw.edu/*",
      "https://www.gradescope.com/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
      "https://mykairos.me/*",
    ]);
    expect(manifest.content_scripts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        matches:["http://localhost/*","http://127.0.0.1/*","https://mykairos.me/*"],
        js:["dist/kairos-bridge.js"],
      }),
      expect.objectContaining({
        matches:["https://www.gradescope.com/*"],
        js:["dist/gradescope-content.js"],
      }),
    ]));
    const serialized=JSON.stringify(manifest);
    expect(serialized).not.toContain("<all_urls>");
    expect(serialized).not.toContain('"https://*/*"');
  });
});
