import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function distribution(){
  const modulePath=path.join(process.cwd(),"src/lib/extension-distribution.ts");
  expect(fs.existsSync(modulePath),"the distribution descriptor must exist").toBe(true);
  return import(modulePath) as Promise<{
    getFirefoxDistribution:(config:{listingUrl?:string})=>{
      state:"pending"|"available";installUrl:string|null;minimumVersion:140;
    };
  }>;
}

describe("Firefox distribution",()=>{
  it("missing_or_foreign_listing_link_stays_pending",async()=>{
    const {getFirefoxDistribution}=await distribution();
    for(const listingUrl of [
      undefined,"","not a URL","http://addons.mozilla.org/en-US/firefox/addon/example/",
      "https://evil.example/firefox/addon/example/",
      "https://addons.mozilla.org.evil.example/firefox/addon/example/",
      "https://addons.mozilla.org@evil.example/firefox/addon/example/",
      "https://evil.example@addons.mozilla.org/en-US/firefox/addon/example/",
      "https://addons.mozilla.org:8443/en-US/firefox/addon/example/",
      "javascript:alert(1)","https://addons.mozilla.org/",
      "https://addons.mozilla.org/en-US/firefox/collections/example/",
      "https://addons.mozilla.org/en-US/firefox/addon/example/?redirect=https://evil.example",
      "https://addons.mozilla.org/en-US/firefox/addon/example/#redirect",
      " https://addons.mozilla.org/en-US/firefox/addon/example/",
      "https://addons.mozilla.org/en-US/firefox/addon/exam\nple/",
      "https://addons.mozilla.org\\en-US\\firefox\\addon\\example\\",
    ]){
      expect(getFirefoxDistribution({listingUrl}),String(listingUrl)).toEqual({
        state:"pending",installUrl:null,minimumVersion:140,
      });
    }
  });

  it("validated_AMO_listing_is_available_without_inventing_a_link",async()=>{
    const {getFirefoxDistribution}=await distribution();
    for(const listingUrl of [
      "https://addons.mozilla.org/en-US/firefox/addon/example/",
      "https://addons.mozilla.org/firefox/addon/example",
      "https://addons.mozilla.org/pt-BR/firefox/addon/example/",
    ]){
      expect(getFirefoxDistribution({listingUrl})).toEqual({
        state:"available",installUrl:listingUrl,minimumVersion:140,
      });
    }
    expect(getFirefoxDistribution({})).toEqual({state:"pending",installUrl:null,minimumVersion:140});
  });
});
