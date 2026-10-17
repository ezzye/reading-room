import {env} from 'cloudflare:workers';
import {isOwner,loadPage,Config} from '../../../lib/education-service';
import {ensureCriticalPage,criticalHeaders,CRITICAL_ID} from '../../../lib/critical-core.mjs';
import {pageResponse} from '../../../lib/page-renderer';
export const dynamic='force-dynamic';
export async function GET(r:Request){
 const c=env as unknown as Config;
 if(!isOwner(r,c))return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open the Times critical edition</title><body style="font:18px/1.6 system-ui;background:#f4f1e9;padding:30px;max-width:750px;margin:auto"><h1>The Times critical edition</h1><p>The owner signs in to open this saved edition and create a sharing link. Friends and family can read a sharing link without signing in.</p><p><a href="/signin-with-chatgpt?return_to=/critical/zombie-tag">Sign in as owner</a></p><p><a href="/">Return to Read EveryThing</a></p></body></html>',{status:401,headers:criticalHeaders});
 await ensureCriticalPage(c.DB);const page=await loadPage(c.DB,CRITICAL_ID);return pageResponse(page,true);
}
