import {env} from 'cloudflare:workers';
import {pageLensOwner} from '../../lib/page-lens-service';
import type {Config} from '../../lib/education-service';
import html from '../../lib/page-lens-connect.html?raw';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{await pageLensOwner(request,env as unknown as Config);}catch(error){if(error instanceof Response)return error;throw error;}
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
}
