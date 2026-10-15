import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const persistTo=mkdtempSync(path.join(tmpdir(),"kairos-d1-"));
const require=createRequire(import.meta.url);
const wranglerPackageJson=require.resolve("wrangler/package.json");
const wranglerCli=path.join(path.dirname(wranglerPackageJson),"bin","wrangler.js");

function wrangler(args,{allowFailure=false}={}){
  const result=spawnSync(process.execPath,[wranglerCli,...args],{
    cwd:process.cwd(),
    encoding:"utf8",
    env:{...process.env,CI:"1",NO_D1_WARNING:"true"},
  });
  if(!allowFailure&&result.status!==0){
    throw new Error(`wrangler ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function execute(sql,{allowFailure=false}={}){
  return wrangler([
    "d1","execute","kairos","--local","--persist-to",persistTo,
    "--command",sql,"--json",
  ],{allowFailure});
}

try{
  // Build the pre-cutover schema before seeding established accounts. Wrangler
  // then applies the complete ordered migration set (including future 0005+).
  const directory=path.join(process.cwd(),"migrations");
  for(const name of readdirSync(directory).filter(name=>/^\d+.*\.sql$/.test(name)).sort()){
    if(name>="0004_onboarding_state.sql")break;
    wrangler([
      "d1","execute","kairos","--local","--persist-to",persistTo,
      "--file",path.join(directory,name),"--json",
    ]);
  }

  execute(`
    INSERT INTO users(id,name,email) VALUES
      ('alice','Alice','alice@example.invalid'),
      ('bob','Bob','bob@example.invalid'),
      ('empty','Established empty user','empty@example.invalid');
    INSERT INTO app_settings(user_id,key,value,updated_at)
    VALUES ('bob','canvas_submission_status_enabled','0','before-cutover');
    INSERT INTO source_connections(
      user_id,id,kind,label,enabled,last_sync_status,created_at,updated_at
    ) VALUES
      ('alice','source-alice','canvas','Canvas',1,'never','2026-10-06T00:00:00.000Z','2026-10-06T00:00:00.000Z'),
      ('bob','source-bob','canvas','Canvas',1,'never','2026-10-06T00:00:00.000Z','2026-10-06T00:00:00.000Z');
    INSERT INTO assignments(
      user_id,id,source_connection_id,source_kind,external_id,course_name,title,status,
      first_seen_at,last_seen_at,created_at,updated_at
    ) VALUES (
      'alice','assignment-alice','source-alice','canvas','ext-a','CSE 000','Valid tenant row','pending',
      '2026-10-06T00:00:00.000Z','2026-10-06T00:00:00.000Z','2026-10-06T00:00:00.000Z','2026-10-06T00:00:00.000Z'
    );
  `);

  wrangler(["d1","migrations","apply","kairos","--local","--persist-to",persistTo]);

  const crossTenant=execute(`
    INSERT INTO assignments(
      user_id,id,source_connection_id,source_kind,external_id,course_name,title,status,
      first_seen_at,last_seen_at,created_at,updated_at
    ) VALUES (
      'bob','assignment-cross','source-alice','canvas','ext-cross','CSE 000','Cross tenant row','pending',
      '2026-10-06T00:00:00.000Z','2026-10-06T00:00:00.000Z','2026-10-06T00:00:00.000Z','2026-10-06T00:00:00.000Z'
    );
  `,{allowFailure:true});

  if(crossTenant.status===0){
    throw new Error("Cross-user composite foreign key insertion unexpectedly succeeded.");
  }

  execute("INSERT INTO users(id) VALUES ('new-after-cutover');");
  wrangler(["d1","migrations","apply","kairos","--local","--persist-to",persistTo]);

  const result=execute(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE id IN ('alice','bob')) AS user_count,
      (SELECT COUNT(*) FROM source_connections WHERE kind='canvas') AS source_count,
      (SELECT COUNT(*) FROM assignments WHERE id='assignment-alice') AS assignment_count,
      (SELECT COUNT(*) FROM app_settings WHERE key='onboarding'
        AND user_id IN ('alice','bob','empty') AND json_extract(value,'$.status')='completed') AS completed_count,
      (SELECT COUNT(*) FROM app_settings WHERE user_id='empty'
        AND key='canvas_submission_status_enabled' AND value='1') AS empty_refresh_count,
      (SELECT COUNT(*) FROM app_settings WHERE user_id='bob'
        AND key='canvas_submission_status_enabled' AND value='0') AS preserved_opt_out_count,
      (SELECT COUNT(*) FROM app_settings WHERE user_id='new-after-cutover' AND key='onboarding') AS later_backfill_count;
  `);
  const output=`${result.stdout}\n${result.stderr}`;
  for(const expected of [
    '"user_count": 2','"source_count": 2','"assignment_count": 1',
    '"completed_count": 3','"empty_refresh_count": 1',
    '"preserved_opt_out_count": 1','"later_backfill_count": 0',
  ]){
    if(!output.includes(expected)){
      throw new Error(`D1 migration verification did not preserve expected rows: missing ${expected}\n${output}`);
    }
  }

  console.log("D1 migrations verified: tenant FKs, established-user cutover (including empty accounts), preserved submission preferences, and idempotent re-application.");
}finally{
  rmSync(persistTo,{recursive:true,force:true});
}
