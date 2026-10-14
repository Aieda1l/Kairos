import {spawnSync} from 'node:child_process';
import {parseMaintenanceArgs} from './lib/maintenance-cli.mjs';
import {withRotationBundle} from './lib/rotation-bundle.mjs';
try{
  // Reject command-line addressing/credentials before building or opening D1.
  parseMaintenanceArgs('rotate',process.argv.slice(2));
  const child=await withRotationBundle(outfile=>spawnSync(process.execPath,[outfile,...process.argv.slice(2)],{env:process.env,stdio:'inherit'}));
  if(child.error||child.signal||child.status===null)throw new Error();
  process.exitCode=child.status;
}catch{console.error(JSON.stringify({code:'MAINTENANCE_FAILED'}));process.exitCode=1;}
