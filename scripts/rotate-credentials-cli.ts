import {createD1MaintenanceClient} from './lib/d1-maintenance-client.mjs';
import {parseMaintenanceArgs} from './lib/maintenance-cli.mjs';
import {credentialKeyringForRotation,rotateStoredCredentials} from '../src/lib/security/credential-rotation';
try{
  const options=parseMaintenanceArgs('rotate',process.argv.slice(2));
  const keyring=credentialKeyringForRotation(process.env);
  const db=createD1MaintenanceClient(process.env);
  const counts=await rotateStoredCredentials(db,keyring,{batchSize:options.batchSize,dryRun:!options.apply});
  console.log(JSON.stringify({code:options.apply?'MAINTENANCE_APPLIED':'MAINTENANCE_DRY_RUN',counts}));
  process.exitCode=counts.failed?1:0;
}catch{console.error(JSON.stringify({code:'MAINTENANCE_FAILED'}));process.exitCode=1;}
