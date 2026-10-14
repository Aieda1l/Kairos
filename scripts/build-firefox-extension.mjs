import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root=fileURLToPath(new URL("../",import.meta.url));

export async function buildFirefoxExtension({outdir=path.join(root,"extension/firefox/dist")}={}){
  const config=JSON.parse(fs.readFileSync(path.join(root,"tsconfig.json"),"utf8"));
  await build({
    absWorkingDir:root,
    // esbuild skips inferred strict-mode directives for files under node_modules.
    // Load the actual config and emit one explicit directive for every extraction location.
    tsconfigRaw:{...config,compilerOptions:{...config.compilerOptions,alwaysStrict:false}},
    banner:{js:'"use strict";'},
    preserveSymlinks:true,
    entryPoints:{
      background:path.join(root,"extension/firefox/src/background.ts"),
      "kairos-bridge":path.join(root,"extension/firefox/src/content/kairos-bridge.ts"),
      "canvas-content":path.join(root,"extension/firefox/src/content/canvas.ts"),
      "gradescope-content":path.join(root,"extension/firefox/src/content/gradescope.ts"),
      popup:path.join(root,"extension/firefox/src/popup.ts"),
    },
    outdir,
    bundle:true,
    platform:"browser",
    format:"iife",
    target:"firefox140",
    minify:false,
    sourcemap:false,
    alias:{"@":path.join(root,"src")},
    logLevel:"info",
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await buildFirefoxExtension();
}
