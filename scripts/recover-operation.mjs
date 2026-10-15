import {runMaintenanceCli} from './lib/maintenance-cli.mjs';
process.exitCode=await runMaintenanceCli('recover');
