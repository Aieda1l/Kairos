import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root=process.cwd();

function read(relativePath:string):string{
  return fs.readFileSync(path.join(root,relativePath),"utf8");
}

describe("Cloudflare runtime configuration",()=>{
  it("defines vinext development and build scripts",()=>{
    const pkg=JSON.parse(read("package.json")) as {scripts?:Record<string,string>};
    expect(pkg.scripts?.["dev:vinext"]).toBeTypeOf("string");
    expect(pkg.scripts?.["build:vinext"]).toBeTypeOf("string");
  });

  it("declares one D1 binding named DB for the kairos database",()=>{
    const wranglerPath=path.join(root,"wrangler.jsonc");
    expect(fs.existsSync(wranglerPath)).toBe(true);
    const wrangler=read("wrangler.jsonc");
    expect(wrangler).toContain('"binding": "DB"');
    expect(wrangler).toContain('"database_name": "kairos"');
  });

  it("configures vinext with the Cloudflare Vite plugin",()=>{
    const vitePath=path.join(root,"vite.config.ts");
    expect(fs.existsSync(vitePath)).toBe(true);
    const vite=read("vite.config.ts");
    expect(vite).toMatch(/vinext/i);
    expect(vite).toMatch(/cloudflare/i);
  });

  it("keeps cloudflare:workers imports out of client-side modules",()=>{
    const clientFiles=[
      "src/features",
      "src/components",
      "extension/firefox/src",
    ];
    for(const relative of clientFiles){
      const dir=path.join(root,relative);
      if(!fs.existsSync(dir))continue;
      const stack=[dir];
      while(stack.length){
        const current=stack.pop()!;
        for(const entry of fs.readdirSync(current,{withFileTypes:true})){
          const full=path.join(current,entry.name);
          if(entry.isDirectory())stack.push(full);
          else if(/\.(ts|tsx)$/.test(entry.name)){
            expect(fs.readFileSync(full,"utf8")).not.toContain("cloudflare:workers");
          }
        }
      }
    }
  });
});
