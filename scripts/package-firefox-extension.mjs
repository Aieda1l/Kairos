import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFirefoxExtension } from "./build-firefox-extension.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
const extensionRoot=path.join(root,"extension/firefox");
const output=path.join(root,"artifacts/firefox");
const resolvedRoot=fs.realpathSync(root);
const runtimeDirectory=path.join(output,"runtime");
const runtimeFiles=[
  "LICENSE","THIRD_PARTY_NOTICES",
  "manifest.json","icon48.png","icon96.png","popup.html",
  "dist/background.js","dist/kairos-bridge.js","dist/canvas-content.js",
  "dist/gradescope-content.js","dist/popup.js",
].sort();

function verifyOutputPath(filename,directory=false){
  const relative=path.relative(root,filename);
  const outside=value=>value===".."||value.startsWith(".."+path.sep)||path.isAbsolute(value);
  const reject=()=>{throw new Error("Unsafe Firefox output path: "+relative);};
  if(!relative||outside(relative))reject();
  const components=relative.split(path.sep);
  let current=path.resolve(root);
  for(let index=0;index<components.length;index++){
    current=path.join(current,components[index]);
    const stat=fs.lstatSync(current,{throwIfNoEntry:false});
    if(!stat){
      // Resolve the nearest existing ancestor before validating the remaining planned path.
      const planned=path.resolve(fs.realpathSync(path.dirname(current)),...components.slice(index));
      if(outside(path.relative(resolvedRoot,planned)))reject();
      return;
    }
    if(stat.isSymbolicLink()||outside(path.relative(resolvedRoot,fs.realpathSync(current))))reject();
    if(index<components.length-1||directory){
      if(!stat.isDirectory())reject();
    }else if(!stat.isFile()||stat.nlink!==1){
      // Hardlinked files can redirect writes just as final-file symlinks can.
      reject();
    }
  }
}

function verifyOutputPaths(archiveNames){
  for(const directory of [path.join(root,"artifacts"),output,runtimeDirectory,path.join(runtimeDirectory,"dist")]){
    verifyOutputPath(directory,true);
  }
  for(const name of [...archiveNames,"SHA256SUMS"])verifyOutputPath(path.join(output,name));
  for(const name of runtimeFiles)verifyOutputPath(path.join(runtimeDirectory,name));
}
const reviewerFiles=[
  "LICENSE","extension/firefox/LICENSE","extension/firefox/THIRD_PARTY_NOTICES",
  "package.json","package-lock.json","tsconfig.json","scripts/build-firefox-extension.mjs",
  "scripts/package-firefox-extension.mjs","extension/firefox/AMO.md","extension/firefox/amo-metadata.json",
  "extension/firefox/manifest.json","extension/firefox/icon48.png","extension/firefox/icon96.png",
  "extension/firefox/popup.html",
  "extension/firefox/src/background.ts","extension/firefox/src/background/broker.ts",
  "extension/firefox/src/canvas/extract-api-status.ts","extension/firefox/src/canvas/extract-status.ts",
  "extension/firefox/src/canvas/fetch-statuses.ts","extension/firefox/src/content/canvas.ts",
  "extension/firefox/src/content/gradescope.ts","extension/firefox/src/content/kairos-bridge.ts",
  "extension/firefox/src/gradescope/errors.ts","extension/firefox/src/gradescope/extract-assignments.ts",
  "extension/firefox/src/gradescope/extract-courses.ts","extension/firefox/src/gradescope/fetch.ts",
  "extension/firefox/src/popup.ts",
  "src/lib/extension-protocol/bridge.ts","src/lib/extension-protocol/gradescope.ts",
  "src/lib/extension-protocol/submission-status.ts","src/lib/submission-status/types.ts",
].sort();

function readFiles(base,allowlist){
  return allowlist.map(name=>{
    const filename=path.join(base,name);
    const relative=path.relative(fs.realpathSync(root),fs.realpathSync(filename));
    if(!fs.lstatSync(filename).isFile()||relative.startsWith("..")||path.isAbsolute(relative)){
      throw new Error("Required package input must be a regular file inside the source tree: "+name);
    }
    return {name,bytes:fs.readFileSync(filename)};
  });
}

const crcTable=Array.from({length:256},(_,index)=>{
  let value=index;
  for(let bit=0;bit<8;bit++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;
  return value>>>0;
});

function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes)crc=crcTable[(crc^byte)&0xff]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}

// Stored ZIP32 entries avoid compressor/platform differences and retain readable bundles.
// Every path is allowlisted and sorted. DOS timestamps are always 1980-01-01 00:00:00.
function zip(files){
  const localEntries=[];
  const centralEntries=[];
  let offset=0;
  for(const {name,bytes} of files){
    const filename=Buffer.from(name,"utf8");
    if(bytes.length>0xffffffff||offset>0xffffffff)throw new Error("Package exceeds ZIP32 limits");
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);
    local.writeUInt16LE(20,4);
    local.writeUInt16LE(0x0800,6);
    local.writeUInt16LE(33,12);
    local.writeUInt32LE(crc32(bytes),14);
    local.writeUInt32LE(bytes.length,18);
    local.writeUInt32LE(bytes.length,22);
    local.writeUInt16LE(filename.length,26);
    const central=Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50,0);
    central.writeUInt16LE(0x0314,4); // Unix, ZIP 2.0: fixed permissions on every platform.
    local.copy(central,6,4,30);
    central.writeUInt32LE((0o100644<<16)>>>0,38);
    central.writeUInt32LE(offset,42);
    localEntries.push(local,filename,bytes);
    centralEntries.push(central,filename);
    offset+=local.length+filename.length+bytes.length;
  }
  const central=Buffer.concat(centralEntries);
  const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(files.length,8);
  end.writeUInt16LE(files.length,10);
  end.writeUInt32LE(central.length,12);
  end.writeUInt32LE(offset,16);
  return Buffer.concat([...localEntries,central,end]);
}

const version=JSON.parse(fs.readFileSync(path.join(extensionRoot,"manifest.json"),"utf8")).version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error("Expected a numeric release version");
const archiveNames=["kairos-bridge-"+version+".zip","kairos-bridge-"+version+"-source.zip"];
// Reject pre-existing linked destinations before even the bundle build can mutate generated files.
verifyOutputPaths(archiveNames);
await buildFirefoxExtension();
const runtime=readFiles(extensionRoot,runtimeFiles);
const archives=[
  {name:archiveNames[0],bytes:zip(runtime)},
  {name:archiveNames[1],bytes:zip(readFiles(root,reviewerFiles))},
];
verifyOutputPaths(archiveNames);
fs.mkdirSync(output,{recursive:true});
verifyOutputPath(runtimeDirectory,true);
fs.rmSync(runtimeDirectory,{recursive:true,force:true});
function writeArtifact(filename,bytes){
  verifyOutputPath(path.dirname(filename),true);
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  verifyOutputPath(filename);
  const fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o644);
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.nlink!==1)throw new Error("Unsafe Firefox artifact file");
    fs.ftruncateSync(fd,0);
    fs.writeFileSync(fd,bytes);
    fs.fchmodSync(fd,0o644);
  }finally{
    fs.closeSync(fd);
  }
}
for(const {name,bytes} of runtime){
  const filename=path.join(runtimeDirectory,name);
  writeArtifact(filename,bytes);
}
const checksums=archives.map(({name,bytes})=>{
  writeArtifact(path.join(output,name),bytes);
  return createHash("sha256").update(bytes).digest("hex")+"  "+name+"\n";
}).join("");
writeArtifact(path.join(output,"SHA256SUMS"),checksums);
console.log("Unsigned Firefox packages: artifacts/firefox/");
console.log(checksums.trimEnd());
