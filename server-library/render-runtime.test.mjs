import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {extractVerifiedPack} from './render-runtime/runtime.mjs';
import {safeRenderDiagnostic,logRenderStage} from './render-runtime/diagnostics.mjs';

const files=['al2023.tar.br','chromium.br','fonts.tar.br','swiftshader.tar.br'];
async function syntheticArchive(folder,extra=false){
 const {default:tar}=await import('./render-runtime/node_modules/tar-fs/index.js');
 const input=join(folder,'input');await mkdir(input);for(const name of [...files,...(extra?['unexpected.txt']:[])])await writeFile(join(input,name),'Synthetic regular file, not browser data: '+name);
 const archive=join(folder,'synthetic.tar');await pipeline(tar.pack(input,{entries:[...files,...(extra?['unexpected.txt']:[])]}),createWriteStream(archive));
 const data=await readFile(archive);return{archive,manifest:{bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}};
}

test('verified TAR extraction retains the four approved regular files instead of skipping them',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'rr-extract-test-'));try{
  const {archive,manifest}=await syntheticArchive(folder),out=join(folder,'out');await extractVerifiedPack(archive,out,{manifest});
  for(const name of files)assert.equal(await readFile(join(out,name),'utf8'),'Synthetic regular file, not browser data: '+name);
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('archive mismatch is refused before creating extraction output; unexpected entries are never written',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'rr-extract-test-'));try{
  const {archive,manifest}=await syntheticArchive(folder,true),bad=join(folder,'bad');
  await assert.rejects(extractVerifiedPack(archive,bad,{manifest:{...manifest,sha256:'0'.repeat(64)}}),/pack_integrity/);await assert.rejects(access(bad));
  const out=join(folder,'out');await assert.rejects(extractVerifiedPack(archive,out,{manifest}),/pack_entry/);await assert.rejects(access(join(out,'unexpected.txt')));
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('diagnostics emit only fixed stages and allowlisted codes or names',()=>{
 const sensitive='https://private.invalid/?account=PRIVATE-PIN secret environment body';
 assert.deepEqual(safeRenderDiagnostic('pack-extract',Object.assign(Error(sensitive),{code:'ENOENT'})),{stage:'pack-extract',errorCode:'ENOENT',errorName:'Error'});
 assert.deepEqual(safeRenderDiagnostic(sensitive,{name:sensitive,message:sensitive,code:sensitive,stack:sensitive}),{stage:'render-error',errorCode:'unclassified',errorName:'Error'});
 const lines=[];logRenderStage('browser-launch',Object.assign(Error(sensitive),{name:'TimeoutError'}),line=>lines.push(line));
 assert.equal(lines.length,1);assert.doesNotMatch(lines[0],/https:|PRIVATE|environment|account|secret/);assert.match(lines[0],/browser-launch/);assert.match(lines[0],/TimeoutError/);
});
