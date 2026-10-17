import {env} from "cloudflare:workers";
import {resolveShared,Config} from "../../../lib/education-service";
import {renderPage,pageHeaders} from "../../../lib/education-core.mjs";
import {pageResponse} from '../../../lib/page-renderer';
import {accessiblePage} from '../../../lib/rooms';
export const dynamic="force-dynamic";
export async function GET(r:Request){const c=env as unknown as Config,token=new URL(r.url).pathname.split('/').pop()||'';const result=await resolveShared(c.DB,token);if(result.page){if(!await accessiblePage(r,c,result.page.id))return new Response('Article not found in this room.',{status:404,headers:pageHeaders});return Response.redirect(new URL('/read/'+result.page.id+'?room='+r.headers.get('x-rr-room-id'),r.url),302);}return new Response(result.message,{status:result.status,headers:pageHeaders});}
