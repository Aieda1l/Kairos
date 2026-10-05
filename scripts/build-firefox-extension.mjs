import path from "node:path";
import { build } from "esbuild";

const root=process.cwd();

await build({
  entryPoints:{
    background:path.join(root,"extension/firefox/src/background.ts"),
    "kairos-bridge":path.join(root,"extension/firefox/src/content/kairos-bridge.ts"),
    "canvas-content":path.join(root,"extension/firefox/src/content/canvas.ts"),
    "gradescope-content":path.join(root,"extension/firefox/src/content/gradescope.ts"),
    popup:path.join(root,"extension/firefox/src/popup.ts"),
  },
  outdir:path.join(root,"extension/firefox/dist"),
  bundle:true,
  platform:"browser",
  format:"iife",
  target:"firefox128",
  alias:{"@":path.join(root,"src")},
  logLevel:"info",
});
