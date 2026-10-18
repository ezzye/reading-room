import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {access,mkdir,mkdtemp,open,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {ARM_PACK} from './manifest.mjs';
import {logRenderStage} from './diagnostics.mjs';

const CACHE=join(tmpdir(),'rr-chromium-153-arm64-verified');
const FILES=new Set(['al2023.tar.br','chromium.br','fonts.tar.br','swiftshader.tar.br']);
const remaining=deadline=>Math.max(0,deadline-Date.now());
const checkDeadline=deadline=>{if(remaining(deadline)<1)throw Error('render_timeout');};
const permittedDownload=url=>url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(url.hostname);

export async function verifyPackFile(file,manifest=ARM_PACK){
 const info=await stat(file);if(info.size!==manifest.bytes)throw Error('pack_integrity');
 const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
 if(hash.digest('hex')!==manifest.sha256)throw Error('pack_integrity');
 return true;
}

async function downloadPack(file,deadline){
 let url=new URL(ARM_PACK.url),response;
 for(let redirects=0;redirects<5;redirects++){
  checkDeadline(deadline);
  if(!permittedDownload(url))throw Error('pack_download');
  response=await fetch(url,{redirect:'manual',credentials:'omit',headers:{Accept:'application/octet-stream'},signal:AbortSignal.timeout(Math.min(15_000,remaining(deadline)))});
  if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('pack_download');url=new URL(location,url);continue;}
  break;
 }
 if(!response?.ok||!response.body||Number(response.headers.get('content-length'))>ARM_PACK.bytes)throw Error('pack_download');
 const handle=await open(file,'wx',0o600),reader=response.body.getReader();let bytes=0;
 try{for(;;){checkDeadline(deadline);const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>ARM_PACK.bytes)throw Error('pack_integrity');await handle.write(part.value);}}
 finally{try{await reader.cancel();}catch{}await handle.close();}
 await verifyPackFile(file);
}

export async function extractVerifiedPack(archive,out,{manifest=ARM_PACK}={}){
 await verifyPackFile(archive,manifest);await mkdir(out,{mode:0o700});
 const {default:tar}=await import('tar-fs');
 let invalidEntry=false;
 // tar-fs ignore/filter returns true to SKIP, unlike Array.filter.
 await pipeline(createReadStream(archive),tar.extract(out,{ignore(_name,header){const name=header.name.replace(/^\.\//,'');const skip=header.type!=='file'||!FILES.has(name);if(skip)invalidEntry=true;return skip;}}));
 if(invalidEntry)throw Error('pack_entry');
 for(const name of FILES)await access(join(out,name));
}

async function verifiedPack(deadline,report){
 report('pack-cache-check');
 try{
  if((await readFile(join(CACHE,'.verified-sha256'),'utf8'))===ARM_PACK.sha256){for(const name of FILES)await access(join(CACHE,name));return CACHE;}
 }catch{/* Only a complete, previously verified pack may be reused. */}
 checkDeadline(deadline);await rm(CACHE,{recursive:true,force:true});
 const staging=await mkdtemp(join(tmpdir(),'rr-chromium-verified-'));
 try{
  const archive=join(staging,'pack.tar'),out=join(staging,'brotli');
  report('pack-download');await downloadPack(archive,deadline);report('pack-verified');checkDeadline(deadline);
  report('pack-extract');await extractVerifiedPack(archive,out);
  await rm(archive,{force:true});await writeFile(join(out,'.verified-sha256'),ARM_PACK.sha256,{mode:0o600});await rename(out,CACHE);
  return CACHE;
 }finally{await rm(staging,{recursive:true,force:true});}
}

/** No local/browser-profile fallback: production loading is restricted to Lambda. */
export async function launchPublicBrowser({deadline=Date.now()+30_000,log}={}){
 let stage='runtime-guard';const report=next=>{stage=next;logRenderStage(stage,undefined,log);};
 try{
 report('runtime-guard');if(process.platform!=='linux'||process.arch!=='arm64'||process.env.AWS_LAMBDA_FUNCTION_NAME!=='reading-room-library')throw Error('render_runtime_unavailable');
 report('dependency-load');const [{default:chromium},{default:puppeteer}]=await Promise.all([import('@sparticuz/chromium-min'),import('puppeteer-core')]);report('dependency-ready');
 const pack=await verifiedPack(deadline,report);report('pack-ready');checkDeadline(deadline);
 chromium.setGraphicsMode=false;
 report('binary-extract');const executablePath=await chromium.executablePath(pack);report('binary-ready');checkDeadline(deadline);
 const profile=await mkdtemp(join(tmpdir(),'rr-public-profile-'));
 try{
  // The child has no AWS credentials, vault settings, account data or inherited
  // application environment. No user agent or client hints are overridden.
  const env={PATH:process.env.PATH||'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_GB.UTF-8'};
  for(const name of ['LD_LIBRARY_PATH','FONTCONFIG_PATH'])if(process.env[name])env[name]=process.env[name];
  const args=chromium.args.filter(arg=>!/user-agent|AutomationControlled|^--disable-web-security$|^--allow-running-insecure-content$/i.test(arg));
  report('browser-launch');const browser=await puppeteer.launch({executablePath,args:await puppeteer.defaultArgs({args,headless:'shell'}),headless:'shell',pipe:true,userDataDir:profile,defaultViewport:{width:1280,height:900,deviceScaleFactor:1},env,timeout:Math.min(12_000,remaining(deadline)),protocolTimeout:Math.min(10_000,remaining(deadline))});
  if(!/\b153\./.test(await browser.version())){await browser.close();throw Error('render_version');}
  report('browser-ready');return {browser,cleanup:()=>rm(profile,{recursive:true,force:true})};
 }catch(error){await rm(profile,{recursive:true,force:true});throw error;}
 }catch(error){logRenderStage(stage,error,log);throw error;}
}
