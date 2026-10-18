import {env} from 'cloudflare:workers';
import {requireRoom} from '../../lib/rooms';
import type {Config} from '../../lib/education-service';
import html from '../../lib/capture-review.html?raw';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{await requireRoom(request,env as unknown as Config);}catch(error){if(error instanceof Response)return error;throw error;}
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
}
