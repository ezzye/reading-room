import html from '../../lib/private-assets-admin.html?raw';
import {env} from 'cloudflare:workers';
import {isOwner} from '../../lib/education-service';
import type {Config} from '../../lib/education-service';
export const dynamic='force-dynamic';
export function GET(request:Request){
  const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
  if(!isOwner(request,env as unknown as Config))return new Response('Not found',{status:404,headers});
  return new Response(html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
}
