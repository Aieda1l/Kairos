import fs from 'node:fs';
import {approvedMigrations,verifyReleaseState} from './lib/release-state.mjs';
try{
 const phase=process.argv[2];if(process.argv.length!==3)throw new Error();
 const manifest=fs.readdirSync('migrations').filter(name=>name.endsWith('.sql')).sort();
 if(JSON.stringify(manifest)!==JSON.stringify(approvedMigrations))throw new Error();
 if(phase==='baseline'&&!process.env.GITHUB_OUTPUT)throw new Error();
 const result=await verifyReleaseState({phase,env:process.env});
 if(phase==='baseline')fs.appendFileSync(process.env.GITHUB_OUTPUT,`workers_subdomain=${result.workersSubdomain}\n`);
 console.log(JSON.stringify({code:'RELEASE_STATE_VERIFIED',phase}));
}catch{console.error(JSON.stringify({code:'RELEASE_STATE_REJECTED'}));process.exitCode=1;}
