import {env} from 'cloudflare:workers';
import html from '../../lib/library-coverage.html?raw';
import {requireRoom} from '../../lib/rooms';
import {isOwner} from '../../lib/education-service';
import type {Config} from '../../lib/education-service';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const config=env as unknown as Config;
 try{const room=await requireRoom(request,config);if(!isOwner(request,config)||room.role!=='owner'||room.owner_id!==room.member_id)return new Response('Owner access to this room is required.',{status:403});
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
 }catch(error){if(error instanceof Response)return error;return new Response('Library coverage checks are unavailable.',{status:503});}
}
