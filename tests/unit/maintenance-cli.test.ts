import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {withRotationBundle} from '../../scripts/lib/rotation-bundle.mjs';
import {parseMaintenanceArgs} from '../../scripts/lib/maintenance-cli.mjs';
it('defaults to read-only and accepts only bounded operator flags',()=>{
  expect(parseMaintenanceArgs('rotate',[])).toEqual({apply:false,batchSize:50});
  expect(parseMaintenanceArgs('cleanup',['--apply','--batch-size=100'])).toEqual({apply:true,batchSize:100});
  expect(parseMaintenanceArgs('set-control',['--key=auth:initiation','--enabled=false'])).toEqual({apply:false,key:'auth:initiation',enabled:false});
  expect(parseMaintenanceArgs('recover',['--operation=source:canvas'])).toEqual({apply:false,operationKey:'source:canvas',settlementConfirmed:false});
  for(const args of [['--token=private'],['--account=private'],['--batch-size=101'],['--apply','--dry-run'],['--batch-size=1','--batch-size=2'],['--settlement-confirmed']])expect(()=>parseMaintenanceArgs('rotate',args)).toThrow();
  expect(()=>parseMaintenanceArgs('recover',['--operation=source:canvas','--apply'])).toThrow();
});
it('all command entrypoints suppress invalid configuration and private argument text',()=>{
  for(const script of ['rotate-credentials','set-abuse-control','maintain-abuse-state','recover-operation']){
    const child=spawnSync(process.execPath,[`scripts/${script}.mjs`,'--SYNTHETIC_PRIVATE_ARGUMENT'],{env:{...process.env,CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:'',CLOUDFLARE_D1_DATABASE_ID:''},encoding:'utf8'});
    expect(child.status).toBe(1);
    expect(child.stdout).toBe('');
    expect(child.stderr.trim()).toBe('{"code":"MAINTENANCE_FAILED"}');
  }
});
it('rotation wrapper bundles the real server entry and emits only fixed configuration failure',async()=>{
  mkdirSync('artifacts/maintenance',{recursive:true});
  const before=new Set(readdirSync('artifacts/maintenance').filter(name=>name.startsWith('rotation-')));
  const child=spawnSync(process.execPath,['scripts/rotate-credentials.mjs','--dry-run'],{
    env:{...process.env,CLOUDFLARE_API_TOKEN:'SYNTHETIC_PRIVATE_ENV_TOKEN',CLOUDFLARE_ACCOUNT_ID:'',CLOUDFLARE_D1_DATABASE_ID:'',KAIROS_CREDENTIAL_KEY_V1:Buffer.from(new Uint8Array(32).fill(1)).toString('base64url'),KAIROS_CREDENTIAL_KEY_V2:Buffer.from(new Uint8Array(32).fill(2)).toString('base64url'),KAIROS_CREDENTIAL_ACTIVE_KEY_ID:'v2'},encoding:'utf8'});
  expect(child.status).toBe(1);expect(child.stdout).toBe('');expect(child.stderr.trim()).toBe('{"code":"MAINTENANCE_FAILED"}');
  const created=readdirSync('artifacts/maintenance').filter(name=>name.startsWith('rotation-')&&!before.has(name));
  expect(created).toHaveLength(0);
  let temporary='';
  await withRotationBundle(outfile=>{
    temporary=path.dirname(outfile);const bundle=readFileSync(outfile,'utf8');
    expect(bundle).toContain('async function rotateStoredCredentials');expect(bundle).not.toContain('SYNTHETIC_PRIVATE_ENV_TOKEN');
  });
  expect(existsSync(temporary)).toBe(false);
  await expect(withRotationBundle(outfile=>{temporary=path.dirname(outfile);throw new Error('synthetic');})).rejects.toThrow('synthetic');
  expect(existsSync(temporary)).toBe(false);
});
