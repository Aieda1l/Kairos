import {expect,it,vi} from 'vitest';
import {assertReleaseGate,parseUploadedVersion,verifyStagedHealth} from '../../scripts/lib/production-release.mjs';
const sha='a'.repeat(40);
it('binds both uploaded URLs to the trusted Cloudflare account subdomain',()=>{
 const version='01234567-89ab-cdef-0123-456789abcdef',alias='m7-'+sha.slice(0,12);
 for(const [aliasAccount,versionAccount] of [['foreign','foreign'],['account','foreign'],['foreign','account']]){
  const row={type:'version-upload',version_id:version,worker_name:'kairos-production',
   preview_alias_url:`https://${alias}-kairos-production.${aliasAccount}.workers.dev`,
   preview_url:`https://01234567-kairos-production.${versionAccount}.workers.dev`};
  expect(()=>parseUploadedVersion([row],alias,'account')).toThrow('Release gate rejected.');
 }
});
const run={id:12,run_attempt:1,head_sha:sha,head_branch:'main',status:'completed',conclusion:'success',event:'push',path:'.github/workflows/milestone-2-ci.yml',head_repository:{full_name:'owner/Kairos'}};
it('requires protected-main intent and the latest exact-revision feature workflow result',()=>{
 expect(()=>assertReleaseGate({ref:'refs/heads/main',sha,repository:'owner/Kairos',runs:[run]})).not.toThrow();
 for(const patch of [{ref:'refs/heads/feature'},{sha:'b'.repeat(40)},{runs:[]},{runs:[{...run,conclusion:'failure'}]},{runs:[{...run,id:13,status:'in_progress',conclusion:null},run]},{runs:[{...run,head_repository:{full_name:'other/Kairos'}}]}]){
  expect(()=>assertReleaseGate({ref:'refs/heads/main',sha,repository:'owner/Kairos',runs:[run],...patch})).toThrow('Release gate rejected.');
 }
});
it('accepts only a single structured version-upload record and its exact alias URL',()=>{
 const version='01234567-89ab-cdef-0123-456789abcdef',alias='m7-'+sha.slice(0,12),preview=`https://${alias}-kairos-production.account.workers.dev`;
 const immutable='https://01234567-kairos-production.account.workers.dev';
 const row={type:'version-upload',version_id:version,worker_name:'kairos-production',preview_alias_url:preview,preview_url:immutable};
 expect(parseUploadedVersion([row],alias,'account')).toEqual({versionId:version,url:immutable});
 for(const rows of [[{...row,version_id:'invalid'}],[{...row,preview_alias_url:'https://unexpected.invalid'}],[row,row],[{...row,preview_alias_url:preview+'?private=1'}]])expect(()=>parseUploadedVersion(rows,alias,'account')).toThrow('Release gate rejected.');
});
it('failed staged storage health prevents promotion without exposing the response',async()=>{
 const url='https://01234567-kairos-production.account.workers.dev';
 const request=vi.fn<typeof fetch>().mockResolvedValue(Response.json({status:'unavailable',private:'do-not-log'},{status:503}));
 await expect(verifyStagedHealth(url,request)).rejects.toThrow('Staged health failed.');
 expect(request).toHaveBeenCalledWith(url+'/api/health',expect.objectContaining({redirect:'error'}));
 await expect(verifyStagedHealth(url,async()=>Response.json({status:'ok'}))).resolves.toBeUndefined();
 await expect(verifyStagedHealth(url,async()=>Response.json({status:'ok',extra:true}))).rejects.toThrow('Staged health failed.');
});
it('checks the immutable version URL rather than a reusable preview alias',()=>{
 const version='01234567-89ab-cdef-0123-456789abcdef',alias='m7-'+sha.slice(0,12);
 const preview=`https://${alias}-kairos-production.account.workers.dev`;
 const immutable='https://01234567-kairos-production.account.workers.dev';
 const row={type:'version-upload',version_id:version,worker_name:'kairos-production',preview_alias_url:preview,preview_url:immutable};
 expect(parseUploadedVersion([row],alias,'account')).toEqual({versionId:version,url:immutable});
 for(const url of [undefined,preview,'https://ffffffff-kairos-production.account.workers.dev']){
  expect(()=>parseUploadedVersion([{...row,preview_url:url}],alias,'account')).toThrow('Release gate rejected.');
 }
});
it('bounds staged-health response time even when a response body never ends',async()=>{
 vi.useFakeTimers();
 try{
  const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));}})));
  const result=expect(verifyStagedHealth('https://01234567-kairos-production.account.workers.dev',request)).rejects.toThrow('Staged health failed.');
  await vi.advanceTimersByTimeAsync(10001);await result;
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
 }finally{vi.useRealTimers();}
});
