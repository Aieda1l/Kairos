import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const root=process.cwd();
const runtimeFiles=[
  "LICENSE","THIRD_PARTY_NOTICES",
  "manifest.json","icon48.png","icon96.png","popup.html",
  "dist/background.js","dist/kairos-bridge.js","dist/canvas-content.js",
  "dist/gradescope-content.js","dist/popup.js",
].sort();
const extensionSources=[
  "background.ts","background/broker.ts","canvas/extract-api-status.ts",
  "canvas/extract-status.ts","canvas/fetch-statuses.ts","content/canvas.ts",
  "content/gradescope.ts","content/kairos-bridge.ts","gradescope/errors.ts",
  "gradescope/extract-assignments.ts","gradescope/extract-courses.ts","gradescope/fetch.ts","popup.ts",
].map(file=>"extension/firefox/src/"+file);
const reviewerFiles=[
  "LICENSE","extension/firefox/LICENSE","extension/firefox/THIRD_PARTY_NOTICES",
  "package.json","package-lock.json","tsconfig.json","scripts/build-firefox-extension.mjs",
  "scripts/package-firefox-extension.mjs","extension/firefox/AMO.md","extension/firefox/amo-metadata.json",
  "extension/firefox/manifest.json","extension/firefox/icon48.png","extension/firefox/icon96.png",
  "extension/firefox/popup.html",...extensionSources,
  "src/lib/extension-protocol/bridge.ts","src/lib/extension-protocol/gradescope.ts",
  "src/lib/extension-protocol/submission-status.ts","src/lib/submission-status/types.ts",
].sort();
const temporaryRoots:string[]=[];
const sha256=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
// Git can convert text line endings on Windows; archive/input byte comparisons remain exact below.
const licenseText=(bytes:Buffer)=>bytes.toString("utf8").replaceAll("\r\n","\n");
const expectedKairosLicense=`MIT License

Copyright (c) 2026 Kairos contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function temporaryRoot(){
  const directory=fs.mkdtempSync(path.join(tmpdir(),"kairos-extension-package-"));
  temporaryRoots.push(directory);
  return directory;
}

afterEach(()=>{
  for(const directory of temporaryRoots.splice(0))fs.rmSync(directory,{recursive:true,force:true});
});

function write(directory:string,file:string,bytes:Buffer|string){
  const destination=path.join(directory,file);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,bytes);
}

function fixture(){
  const directory=temporaryRoot();
  for(const file of reviewerFiles){
    if(fs.existsSync(path.join(root,file)))write(directory,file,fs.readFileSync(path.join(root,file)));
  }
  fs.symlinkSync(path.join(root,"node_modules"),path.join(directory,"node_modules"),"junction");
  return directory;
}

// Read the central directory independently of the packager; support stored and deflated ZIP entries.
function unzip(bytes:Buffer){
  const end=bytes.length-22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  const files=new Map<string,{bytes:Buffer;date:number;time:number;mode:number;system:number}>();
  let offset=bytes.readUInt32LE(end+16);
  for(let i=0;i<bytes.readUInt16LE(end+10);i++){
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
    const nameLength=bytes.readUInt16LE(offset+28);
    const extraLength=bytes.readUInt16LE(offset+30);
    const commentLength=bytes.readUInt16LE(offset+32);
    const name=bytes.subarray(offset+46,offset+46+nameLength).toString("utf8");
    const method=bytes.readUInt16LE(offset+10);
    const size=bytes.readUInt32LE(offset+20);
    const local=bytes.readUInt32LE(offset+42);
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    const payload=bytes.subarray(start,start+size);
    expect([0,8]).toContain(method);
    expect(files.has(name),"duplicate archive path: "+name).toBe(false);
    files.set(name,{
      bytes:method===8?inflateRawSync(payload):payload,
      date:bytes.readUInt16LE(offset+14),time:bytes.readUInt16LE(offset+12),
      mode:bytes.readUInt32LE(offset+38)>>>16,system:bytes[offset+5],
    });
    offset+=46+nameLength+extraLength+commentLength;
  }
  return files;
}

function packageExtension(directory:string,timezone="UTC"){
  expect(fs.existsSync(path.join(directory,"scripts/package-firefox-extension.mjs")),
    "the allowlisted release packager must exist").toBe(true);
  const result=spawnSync(process.execPath,[path.join(directory,"scripts/package-firefox-extension.mjs")],{
    cwd:directory,encoding:"utf8",timeout:15_000,env:{...process.env,TZ:timezone},
  });
  expect(result.status,result.stdout+result.stderr).toBe(0);
  const artifacts=path.join(directory,"artifacts/firefox");
  return {
    runtime:fs.readFileSync(path.join(artifacts,"kairos-bridge-0.4.0.zip")),
    source:fs.readFileSync(path.join(artifacts,"kairos-bridge-0.4.0-source.zip")),
    checksums:fs.readFileSync(path.join(artifacts,"SHA256SUMS"),"utf8"),
  };
}

describe("Firefox release archives",()=>{
  it.each([
    "artifacts","artifacts/firefox","artifacts/firefox/runtime","artifacts/firefox/runtime/dist",
  ])("rejects linked output directory %s before any generated-output mutation",linkedPath=>{
    const directory=fixture();
    const outside=temporaryRoot();
    const sentinel="OUTSIDE_DIRECTORY_SENTINEL";
    write(outside,"runtime/keep-me.txt",sentinel);
    write(outside,"keep-me.txt",sentinel);
    const before=fs.readdirSync(outside).sort();
    const link=path.join(directory,linkedPath);
    fs.mkdirSync(path.dirname(link),{recursive:true});
    fs.symlinkSync(outside,link,"junction");
    const result=spawnSync(process.execPath,[path.join(directory,"scripts/package-firefox-extension.mjs")],{
      cwd:directory,encoding:"utf8",timeout:15_000,
    });
    expect(result.status,result.stdout+result.stderr).not.toBe(0);
    expect(fs.readFileSync(path.join(outside,"runtime/keep-me.txt"),"utf8")).toBe(sentinel);
    expect(fs.readFileSync(path.join(outside,"keep-me.txt"),"utf8")).toBe(sentinel);
    expect(fs.readdirSync(outside).sort()).toEqual(before);
    expect(fs.existsSync(path.join(directory,"extension/firefox/dist/background.js"))).toBe(false);
  });

  it.each([
    "kairos-bridge-0.4.0.zip","kairos-bridge-0.4.0-source.zip","SHA256SUMS","runtime/manifest.json",
  ])("rejects linked artifact file %s without overwriting its external target",artifact=>{
    const directory=fixture();
    const outside=temporaryRoot();
    const sentinel="OUTSIDE_FILE_SENTINEL";
    write(outside,"protected.txt",sentinel);
    const target=path.join(outside,"protected.txt");
    const link=path.join(directory,"artifacts/firefox",artifact);
    fs.mkdirSync(path.dirname(link),{recursive:true});
    // Windows hardlinks need no symlink privilege; POSIX exercises final-file symlink rejection.
    if(process.platform==="win32")fs.linkSync(target,link);
    else fs.symlinkSync(target,link,"file");
    const result=spawnSync(process.execPath,[path.join(directory,"scripts/package-firefox-extension.mjs")],{
      cwd:directory,encoding:"utf8",timeout:15_000,
    });
    expect(result.status,result.stdout+result.stderr).not.toBe(0);
    expect(fs.readFileSync(target,"utf8")).toBe(sentinel);
    expect(fs.existsSync(path.join(directory,"extension/firefox/dist/background.js"))).toBe(false);
  });

  it("artifact_ignore_remains_one_pattern_in_a_glob_expanding_shell",()=>{
    const directory=temporaryRoot();
    write(directory,"eslint.config.mjs",'export default [{rules:{"no-undef":"error"}}];\n');
    write(directory,"valid.js","export const valid=1;\n");
    write(directory,"artifacts/firefox/generated.js","PRIVATE_ARTIFACT_SENTINEL();\n");
    write(directory,"artifacts/maintenance/generated.js","PRIVATE_ARTIFACT_SENTINEL();\n");
    const script=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).scripts.lint;
    const shellQuote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
    const eslint=path.join(root,"node_modules/eslint/bin/eslint.js").replaceAll("\\","/");
    const node=process.execPath.replaceAll("\\","/");
    const bash=process.platform==="win32"?"C:/Program Files/Git/bin/bash.exe":"/bin/bash";
    const command="eslint() { "+shellQuote(node)+" "+shellQuote(eslint)+' "$@"; }\nshopt -s globstar\n'+script;
    const result=spawnSync(bash,["-c",command],{cwd:directory,encoding:"utf8",timeout:15_000});
    expect(result.status,result.error?.message??result.stdout+result.stderr).toBe(0);
  });

  it("runtime_archive_contains_only_licenses_manifest_icons_popup_and_five_bundles",()=>{
    const directory=fixture();
    write(directory,"extension/firefox/dist/obsolete.js","must not ship");
    const {runtime}=packageExtension(directory);
    const members=unzip(runtime);
    expect([...members.keys()]).toEqual(runtimeFiles);
    for(const file of runtimeFiles){
      expect(members.get(file)?.bytes.equals(fs.readFileSync(path.join(directory,"extension/firefox",file)))).toBe(true);
    }
    const manifest=JSON.parse(members.get("manifest.json")!.bytes.toString("utf8"));
    expect(manifest.browser_specific_settings.gecko.id).toBe("kairos-local@kairos");
    expect(manifest.version).toBe("0.4.0");
  });

  it("reviewer_archive_has_complete_protocol_sources_and_lockfile",()=>{
    const directory=fixture();
    const {runtime,source}=packageExtension(directory);
    const members=unzip(source);
    expect([...members.keys()]).toEqual(reviewerFiles);
    for(const file of reviewerFiles){
      expect(members.get(file)?.bytes.equals(fs.readFileSync(path.join(directory,file))),file).toBe(true);
    }
    const packageJson=JSON.parse(members.get("package.json")!.bytes.toString("utf8"));
    const lock=JSON.parse(members.get("package-lock.json")!.bytes.toString("utf8"));
    expect(packageJson.devDependencies["web-ext"]).toBe("10.7.0");
    expect(lock.packages[""].devDependencies["web-ext"]).toBe("10.7.0");
    expect(lock.packages["node_modules/web-ext"].version).toBe("10.7.0");
    expect(lock.packages["node_modules/web-ext"].integrity).toMatch(/^sha512-/);
    expect(packageJson.license).toBe("MIT");
    expect(lock.packages[""].license).toBe("MIT");
    const metadata=JSON.parse(members.get("extension/firefox/amo-metadata.json")!.bytes.toString("utf8"));
    expect(metadata.license).toBe("MIT");

    // esbuild skips implicit tsconfig lookup under node_modules; reproduction must select the shipped config.
    const extracted=path.join(temporaryRoot(),"node_modules","kairos-reviewer");
    fs.mkdirSync(extracted,{recursive:true});
    for(const [file,entry] of members)write(extracted,file,entry.bytes);
    // Only installed dependencies are shared. No extension or application source is available outside the archive.
    fs.symlinkSync(path.join(root,"node_modules"),path.join(extracted,"node_modules"),"junction");
    const rebuild=spawnSync(process.execPath,[path.join(extracted,"scripts/build-firefox-extension.mjs")],{
      cwd:tmpdir(),encoding:"utf8",timeout:15_000,
    });
    expect(rebuild.status,rebuild.stdout+rebuild.stderr).toBe(0);
    const original=unzip(runtime);
    for(const file of runtimeFiles.filter(file=>file.startsWith("dist/"))){
      const rebuilt=fs.readFileSync(path.join(extracted,"extension/firefox",file));
      const expected=original.get(file)!.bytes;
      const mismatch=rebuilt.findIndex((byte,index)=>byte!==expected[index]);
      const start=Math.max(0,mismatch-80);
      expect(rebuilt.equals(expected),file+" expected: "+expected.subarray(start,start+240).toString("utf8")+
        " rebuilt: "+rebuilt.subarray(start,start+240).toString("utf8")).toBe(true);
    }
  });

  it.each(["LF","CRLF"])("archives_preserve_complete_Kairos_license_and_installed_third_party_notices_with_%s",lineEndings=>{
    const directory=fixture();
    if(lineEndings==="CRLF"){
      for(const file of ["LICENSE","extension/firefox/LICENSE","extension/firefox/THIRD_PARTY_NOTICES"]){
        const filename=path.join(directory,file);
        const text=fs.readFileSync(filename,"utf8").replaceAll("\r\n","\n");
        fs.writeFileSync(filename,text.replaceAll("\n","\r\n"));
      }
    }
    const {runtime,source}=packageExtension(directory);
    const runtimeMembers=unzip(runtime);
    const sourceMembers=unzip(source);
    for(const [members,file] of [
      [runtimeMembers,"LICENSE"],
      [sourceMembers,"LICENSE"],
      [sourceMembers,"extension/firefox/LICENSE"],
    ] as const){
      expect(members.has(file),"missing license archive member: "+file).toBe(true);
      expect(licenseText(members.get(file)!.bytes)).toBe(expectedKairosLicense);
    }
    const rootLicense=fs.readFileSync(path.join(directory,"LICENSE"));
    const extensionLicense=fs.readFileSync(path.join(directory,"extension/firefox/LICENSE"));
    expect(extensionLicense.equals(rootLicense)).toBe(true);
    expect(runtimeMembers.get("LICENSE")!.bytes.equals(rootLicense)).toBe(true);

    expect(runtimeMembers.has("THIRD_PARTY_NOTICES")).toBe(true);
    expect(sourceMembers.has("extension/firefox/THIRD_PARTY_NOTICES")).toBe(true);
    const runtimeNotices=runtimeMembers.get("THIRD_PARTY_NOTICES")!.bytes;
    expect(sourceMembers.get("extension/firefox/THIRD_PARTY_NOTICES")!.bytes.equals(runtimeNotices)).toBe(true);
    expect(runtimeNotices.equals(fs.readFileSync(path.join(directory,"extension/firefox/THIRD_PARTY_NOTICES")))).toBe(true);
    for(const file of ["node_modules/zod/LICENSE","node_modules/esbuild/LICENSE.md"]){
      const completeNotice=fs.readFileSync(path.join(root,file));
      expect(licenseText(runtimeNotices).includes(licenseText(completeNotice)),
        "complete installed notice must survive packaging: "+file).toBe(true);
    }
  });

  it("archives_exclude_env_fixtures_and_credentials",()=>{
    const directory=fixture();
    const sentinel="PRIVATE_INPUT_SENTINEL_never_ship";
    for(const file of [
      ".env",".env.example",".env.production","credentials.json",".npmrc",
      "extension/firefox/.env","extension/firefox/credentials.json",
      "extension/firefox/tests/fixtures/private.html","extension/firefox/src/private-token.txt",
      "extension/firefox/dist/private.js","extension/firefox/dist/background.js.map",
      "src/lib/extension-protocol/private-token.json","artifacts/firefox/private-input.txt",
      "artifacts/firefox/runtime/stale-private-input.txt",
      ".superpowers/sdd/private-input.txt",
    ])write(directory,file,sentinel);
    const archives=packageExtension(directory);
    for(const archive of [archives.runtime,archives.source]){
      for(const [name,entry] of unzip(archive)){
        expect(name).not.toMatch(/(?:\.env|\.npmrc|credentials|private|fixtures|tests\/|\.map$|node_modules|artifacts|\.superpowers)/);
        expect(name).not.toContain("\\");
        expect(entry.bytes.toString("utf8")).not.toContain(sentinel);
      }
    }
    expect(fs.existsSync(path.join(directory,"artifacts/firefox/runtime/stale-private-input.txt"))).toBe(false);
  });

  it("archives_and_checksums_are_reproducible_across_mtimes_and_timezones",()=>{
    const directory=fixture();
    const first=packageExtension(directory);
    for(const file of reviewerFiles)fs.utimesSync(path.join(directory,file),new Date(),new Date());
    const second=packageExtension(directory,"America/Los_Angeles");
    expect(second.runtime.equals(first.runtime)).toBe(true);
    expect(second.source.equals(first.source)).toBe(true);
    expect(second.checksums).toBe(first.checksums);
    expect(first.checksums).toBe(
      sha256(first.runtime)+"  kairos-bridge-0.4.0.zip\n"+
      sha256(first.source)+"  kairos-bridge-0.4.0-source.zip\n",
    );
    for(const archive of [first.runtime,first.source]){
      for(const entry of unzip(archive).values()){
        expect(entry.date).toBe(33); // 1980-01-01, independent of the host clock or timezone.
        expect(entry.time).toBe(0);
        expect(entry.mode).toBe(0o100644);
        expect(entry.system).toBe(3); // Fixed Unix file metadata, even when packaged on Windows.
      }
    }
  });
});
