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

  it("manifest_preserves_id_and_origins",()=>{
    const manifest=JSON.parse(fs.readFileSync(path.join(process.cwd(),"extension/firefox/manifest.json"),"utf8"));
    expect(manifest.version).toBe("0.4.0");
    expect(manifest.browser_specific_settings.gecko).toEqual({
      id:"kairos-local@kairos",
      strict_min_version:"140.0",
      data_collection_permissions:{required:["websiteContent","browsingActivity"]},
    });
    expect(manifest.permissions).toEqual(["tabs"]);
    expect(manifest.host_permissions).toEqual([
      "https://canvas.uw.edu/*",
      "https://www.gradescope.com/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
      "https://mykairos.me/*",
    ]);
    expect(manifest.content_scripts.flatMap((script:{matches:string[]})=>script.matches)).toEqual([
      "http://localhost/*","http://127.0.0.1/*","https://mykairos.me/*",
      "https://canvas.uw.edu/*","https://www.gradescope.com/*",
    ]);
  });

  it("manifest_requires_native_consent_version_floors_on_desktop_and_Android",()=>{
    const manifest=JSON.parse(fs.readFileSync(path.join(process.cwd(),"extension/firefox/manifest.json"),"utf8"));
    expect(manifest.browser_specific_settings.gecko.strict_min_version).toBe("140.0");
    expect(manifest.browser_specific_settings.gecko_android).toEqual({strict_min_version:"142.0"});
    expect(manifest.browser_specific_settings.gecko.data_collection_permissions).toEqual({
      required:["websiteContent","browsingActivity"],
    });
    const metadata=JSON.parse(fs.readFileSync(path.join(process.cwd(),"extension/firefox/amo-metadata.json"),"utf8"));
    expect(metadata.dataCollectionPermissions).toEqual({required:["websiteContent","browsingActivity"]});
  });
});
