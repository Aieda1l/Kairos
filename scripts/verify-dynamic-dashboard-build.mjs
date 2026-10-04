import fs from "node:fs";

const manifest=JSON.parse(fs.readFileSync(".next/prerender-manifest.json","utf8"));
const dashboardRoutes=["/upcoming","/calendar","/assignments","/sources","/settings"];
const prerendered=dashboardRoutes.filter(route=>Object.prototype.hasOwnProperty.call(manifest.routes??{},route));

if(prerendered.length>0){
  console.error(
    "Dashboard routes must render from the current local SQLite state at request time. "+
    "Unexpected prerendered routes: "+prerendered.join(", "),
  );
  process.exit(1);
}

console.log("Dashboard routes are request-time rendered:",dashboardRoutes.join(", "));
