import {env} from 'cloudflare:workers';
import html from '../../lib/press-check.html?raw';
import script from '../../lib/press-check.mjs?raw';
import sources from '../../lib/press-check-sources.json';
import {requireRoom} from '../../lib/rooms';
import type {Config} from '../../lib/education-service';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 try{
  const room=await requireRoom(request,env as unknown as Config);
  if(room.role!=='owner')return new Response('Only the room owner can run the press check.',{status:403});
  const data=JSON.stringify({...sources,room:{id:room.id,name:room.name}}).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
  return new Response(html.replace('<!-- PRESS_CHECK_SOURCES -->',data).replace('<!-- PRESS_CHECK_SCRIPT -->',`<script>${script}</script>`),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'"}});
 }catch(error){return error instanceof Response?error:new Response('Press check is unavailable.',{status:503});}
}
