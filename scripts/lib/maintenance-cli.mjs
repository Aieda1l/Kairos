import {createD1MaintenanceClient} from './d1-maintenance-client.mjs';
import {maintainAbuseState,recoverOperation,setAbuseControl} from './abuse-maintenance.mjs';
const invalid=()=>new Error('Maintenance unavailable.');
export function parseMaintenanceArgs(mode,args){
  if(!['rotate','cleanup','set-control','recover'].includes(mode))throw invalid();
  const values=new Map(),flags=new Set();
  for(const arg of args){
    if(typeof arg!=='string')throw invalid();
    const match=/^--(batch-size|key|enabled|operation)=(.+)$/.exec(arg);
    if(match){if(values.has(match[1]))throw invalid();values.set(match[1],match[2]);}
    else if(['--apply','--dry-run','--settlement-confirmed'].includes(arg)){if(flags.has(arg))throw invalid();flags.add(arg);}
    else throw invalid();
  }
  if(flags.has('--apply')&&flags.has('--dry-run'))throw invalid();
  const permitted=mode==='set-control'?['key','enabled']:mode==='recover'?['operation']:['batch-size'];
  if([...values.keys()].some(key=>!permitted.includes(key))||(mode!=='recover'&&flags.has('--settlement-confirmed')))throw invalid();
  const apply=flags.has('--apply'),settlementConfirmed=flags.has('--settlement-confirmed');
  if(mode==='set-control'){
    if(!values.has('key')||!['true','false'].includes(values.get('enabled')))throw invalid();
    return {apply,key:values.get('key'),enabled:values.get('enabled')==='true'};
  }
  if(mode==='recover'){
    const operationKey=values.get('operation');
    if(!/^(source:(canvas|ed|gradescope)|calendar:(google|microsoft|caldav))$/.test(operationKey??'')||(apply&&!settlementConfirmed))throw invalid();
    return {apply,settlementConfirmed,operationKey};
  }
  const text=values.get('batch-size')??(mode==='rotate'?'50':'100');
  if(!/^(?:[1-9][0-9]?|100)$/.test(text))throw invalid();
  return {apply,batchSize:Number(text)};
}
export async function runMaintenanceCli(mode,args=process.argv.slice(2),env=process.env){
  try{
    const options=parseMaintenanceArgs(mode,args),db=createD1MaintenanceClient(env);
    let counts;
    if(mode==='cleanup')counts=await maintainAbuseState(db,options);
    else if(mode==='set-control')counts=await setAbuseControl(db,options);
    else if(mode==='recover')counts=await recoverOperation(db,{...options,userId:env.KAIROS_RECOVERY_USER_ID,ownerNonce:env.KAIROS_RECOVERY_OWNER_NONCE});
    else throw invalid();
    console.log(JSON.stringify({code:options.apply?'MAINTENANCE_APPLIED':'MAINTENANCE_DRY_RUN',counts,
      ...(mode==='recover'?{settlement:options.settlementConfirmed?'operator_confirmed':'operator_confirmation_required'}:{})}));
    return 0;
  }catch{console.error(JSON.stringify({code:'MAINTENANCE_FAILED'}));return 1;}
}
