import {assertReleaseGate} from './lib/production-release.mjs';
try{
 const {GITHUB_REF:ref,GITHUB_SHA:sha,GITHUB_REPOSITORY:repository,GH_TOKEN:token}=process.env;
 if(ref!=='refs/heads/main'||!/^[-\w]+\/[-\w.]+$/.test(repository??'')||!/^[a-f0-9]{40}$/.test(sha??'')||!token)throw new Error();
 const url=new URL(`https://api.github.com/repos/${repository}/actions/workflows/milestone-2-ci.yml/runs`);
 url.searchParams.set('head_sha',sha);url.searchParams.set('branch','main');url.searchParams.set('per_page','20');
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
 if(!response.ok)throw new Error();
 const reader=response.body?.getReader();if(!reader)throw new Error();let text='',bytes=0;const decoder=new TextDecoder();
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1048576)throw new Error();text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{void reader.cancel().catch(()=>{});}
 const body=JSON.parse(text);assertReleaseGate({ref,sha,repository,runs:body.workflow_runs});
 console.log(JSON.stringify({code:'RELEASE_CI_VERIFIED'}));
}catch{console.error(JSON.stringify({code:'RELEASE_CI_REQUIRED'}));process.exitCode=1;}
