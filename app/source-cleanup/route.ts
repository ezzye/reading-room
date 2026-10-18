import {env} from 'cloudflare:workers';
import html from '../../lib/source-cleanup.html?raw';
import {requireRoom,accessiblePage} from '../../lib/rooms';
import type {Config} from '../../lib/education-service';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const config=env as unknown as Config,room=await requireRoom(request,config),id=new URL(request.url).searchParams.get('id')||'';
 if(room.role!=='owner'||room.owner_id!==room.member_id)return new Response('Only this room’s owner can check source cleanup.',{status:403});
 if(!/^[a-f0-9]{48}$/.test(id)||!await accessiblePage(request,config,id))return new Response('Article not found in this room.',{status:404});
 const data=JSON.stringify({id,room:room.id}).replace(/</g,'\\u003c');return new Response(html.replace('<!-- CLEANUP_DATA -->',data),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"}});
 }catch(error){return error instanceof Response?error:new Response('Source cleanup is unavailable.',{status:503});}}
