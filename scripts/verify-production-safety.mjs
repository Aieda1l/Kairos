import fs from "node:fs";
import path from "node:path";

const errors=[];

function read(relative){
  return fs.readFileSync(path.join(process.cwd(),relative),"utf8");
}

function collectFiles(root){
  const out=[];
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    const full=path.join(root,entry.name);
    if(entry.isDirectory())out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

const pkg=JSON.parse(read("package.json"));
const wrangler=JSON.parse(read("wrangler.jsonc"));
const ci=read(".github/workflows/milestone-2-ci.yml");
const manifest=JSON.parse(read("extension/firefox/manifest.json"));
const bridge=read("extension/firefox/src/content/kairos-bridge.ts");
const envExample=read(".env.example");

const production=wrangler.env?.production??{};
const productionVars=production.vars??{};
const productionObservability=production.observability??wrangler.observability;
if(productionObservability?.redact_query_string!==true){
  errors.push("Production must redact OAuth query strings from platform logs and traces.");
}
if(productionObservability?.enabled!==false
  ||productionObservability?.logs?.enabled!==false
  ||productionObservability?.logs?.persist!==false
  ||productionObservability?.logs?.invocation_logs!==false
  ||productionObservability?.traces?.enabled!==false
  ||productionObservability?.traces?.persist!==false){
  errors.push("Production observability, log persistence, invocation metadata, and traces must remain explicitly disabled until the preview privacy gate is reviewed.");
}
if(String(productionVars.E2E_FIXTURES??"")==="1"){
  errors.push("Production Wrangler configuration enables E2E_FIXTURES.");
}
if(String(productionVars.KAIROS_LOCAL_AUTH??'').trim()||productionVars.KAIROS_ABUSE_TRUSTED_INGRESS==='loopback'){
  errors.push('Production must not select local authentication or loopback ingress.');
}
for(const name of ['KAIROS_TURNSTILE_SITE_KEY','KAIROS_TURNSTILE_SECRET_KEY']){
  const value=String(productionVars[name]??'').trim();
  if(/^[123]x0+(?:AA|AB|BB|FF)$/.test(value)||['synthetic-site','synthetic-secret'].includes(value)){
    errors.push(`Production must not use a known Turnstile test value for ${name}.`);
  }
}

for(const file of collectFiles(path.join(process.cwd(),"src"))){
  if(fs.readFileSync(file,"utf8").includes("better-sqlite3")){
    errors.push(`Production source imports better-sqlite3: ${path.relative(process.cwd(),file)}`);
  }
}

const kairosBridgeScript=manifest.content_scripts?.find(entry=>
  entry.js?.includes("dist/kairos-bridge.js"),
);
const kairosMatches=kairosBridgeScript?.matches??[];
if(!kairosMatches.includes("https://mykairos.me/*")){
  errors.push("Firefox bridge manifest is missing the canonical production origin.");
}
if(
  kairosMatches.some(match=>match==="<all_urls>"||match.includes("https://*"))
  || !bridge.includes('"https://mykairos.me"')
){
  errors.push("Firefox bridge production origin is wildcarded or missing from the runtime allowlist.");
}

const requiredCiCommands=[
  "npm ci --no-audit --no-fund",
  "npm test",
  "npm run lint",
  "npm run typecheck",
  "npm run db:verify",
  "npm run verify:workerd:abuse",
  "npm run build:extension",
  "npm run test:e2e",
  "npm run build",
  "npm run build:vinext",
  "node scripts/verify-dynamic-dashboard-build.mjs",
  "npm run verify:hosted",
];
let lastIndex=-1;
for(const command of requiredCiCommands){
  const escaped=command.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const index=ci.search(new RegExp(`${escaped}(?=\\s|$)`));
  if(index<0){
    errors.push(`Feature CI is missing required command: ${command}`);
  }else if(index<lastIndex){
    errors.push(`Feature CI command is out of required order: ${command}`);
  }else{
    lastIndex=index;
  }
}

if(pkg.scripts?.["verify:hosted"]!=="node scripts/verify-production-safety.mjs"){
  errors.push("package.json is missing the verify:hosted safety script.");
}
if(pkg.scripts?.['verify:workerd:abuse']!=='node scripts/verify-workerd-abuse.mjs')errors.push('Native admission/ownership verification script is missing.');
if(!ci.includes('feat/milestone-7-public-beta-readiness'))errors.push('Feature CI must cover the Milestone 7 branch.');

const deployPath=path.join(process.cwd(),".github/workflows/deploy-production.yml");
if(!fs.existsSync(deployPath)){
  errors.push("Manual production deployment workflow is missing.");
}else{
  const deploy=fs.readFileSync(deployPath,"utf8");
  if(!/^\s*workflow_dispatch\s*:/m.test(deploy)){
    errors.push("Production deployment workflow must use workflow_dispatch.");
  }
  if(/^\s*(push|pull_request)\s*:/m.test(deploy)){
    errors.push("Production deployment workflow must not run automatically from branches or pull requests.");
  }
  for(const required of [
    "environment: production",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_D1_DATABASE_ID",
    "d1 migrations apply",
    "--remote",
    "npm run build:vinext",
    "wrangler deploy",
    "KAIROS_RELEASE_ID",
    "scripts/check-production-health.mjs",
  ]){
    if(!deploy.includes(required))errors.push(`Production deployment workflow is missing: ${required}`);
  }
  if(/E2E_FIXTURES\s*:\s*["']?1["']?/m.test(deploy)){
    errors.push("Production deployment workflow enables E2E fixtures.");
  }
  if(/KAIROS_(?:LOCAL_AUTH|ABUSE_TRUSTED_INGRESS)\s*:\s*["']?loopback/m.test(deploy))errors.push('Production deployment workflow selects local auth/ingress.');
}

const healthWorkflowPath=path.join(process.cwd(),'.github/workflows/production-health.yml');
if(!fs.existsSync(healthWorkflowPath)){
  errors.push('Production health workflow is missing.');
}else{
  const health=fs.readFileSync(healthWorkflowPath,'utf8');
  for(const required of ['*/15 * * * *','workflow_dispatch:','contents: read','concurrency:','cancel-in-progress: false','timeout-minutes: 2','scripts/check-production-health.mjs']){
    if(!health.includes(required))errors.push(`Production health workflow is missing: ${required}`);
  }
  if(/secrets\.|CLOUDFLARE_API_TOKEN|(?:contents|actions|id-token):\s*write/.test(health))errors.push('Public health workflow must not require secrets or write permissions.');
}

const sensitiveName=/(SECRET|TOKEN|PASSWORD|CREDENTIAL_KEY|CLIENT_SECRET)/i;
for(const [name,value] of Object.entries(productionVars)){
  if(sensitiveName.test(name)&&String(value).trim().length>0){
    errors.push(`Checked-in production config contains a value for sensitive binding ${name}.`);
  }
}
for(const line of envExample.split(/\r?\n/)){
  const match=line.match(/^([A-Z0-9_]+)=(.*)$/);
  if(!match)continue;
  const [,name,value]=match;
  if(sensitiveName.test(name)&&value.trim().length>0){
    errors.push(`.env.example contains a non-placeholder value for sensitive variable ${name}.`);
  }
}

const productionId=production.d1_databases?.[0]?.database_id;
const previewId=wrangler.env?.preview?.d1_databases?.[0]?.database_id;
if(productionId!=="11111111-1111-1111-1111-111111111111"){
  errors.push("Checked-in production D1 database ID must remain the documented placeholder.");
}
if(!previewId||previewId===productionId){
  errors.push("Preview D1 binding must be present and distinct from production.");
}

if(errors.length>0){
  for(const error of errors)console.error(`- ${error}`);
  process.exit(1);
}

console.log("Production safety verification passed.");
