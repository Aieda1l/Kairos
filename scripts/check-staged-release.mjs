import fs from 'node:fs';
import {parseUploadedVersion,verifyStagedHealth,verifyStagedIsolation} from './lib/production-release.mjs';
try{
 const {KAIROS_UPLOAD_OUTPUT:filename,KAIROS_PREVIEW_ALIAS:alias,GITHUB_OUTPUT:output}=process.env;
 if(!filename||!output)throw new Error();
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 let text;try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>1048576)throw new Error();text=fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
 const rows=text.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 const uploaded=parseUploadedVersion(rows,alias,process.env.KAIROS_WORKERS_SUBDOMAIN);await verifyStagedHealth(uploaded.url);
 await verifyStagedIsolation(uploaded.url);
 fs.appendFileSync(output,`version_id=${uploaded.versionId}\n`);
 console.log(JSON.stringify({code:'STAGED_RELEASE_HEALTHY'}));
}catch{console.error(JSON.stringify({code:'STAGED_RELEASE_REJECTED'}));process.exitCode=1;}
