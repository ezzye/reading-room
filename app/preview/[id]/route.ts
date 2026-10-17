import {isEditionAuthor} from '../../../lib/edition-access';
import {env} from "cloudflare:workers";
import {isOwner,loadPage,Config} from "../../../lib/education-service";
import {renderPage,pageHeaders} from "../../../lib/education-core.mjs";
import {pageResponse} from '../../../lib/page-renderer';
import {accessiblePage} from '../../../lib/rooms';
export const dynamic="force-dynamic";
export async function GET(r:Request){const c=env as unknown as Config;const id=new URL(r.url).pathname.split('/').pop()||'';if(!/^[a-f0-9]{48}$/.test(id)||!await accessiblePage(r,c,id))return new Response("Page not found",{status:404,headers:pageHeaders});return Response.redirect(new URL('/read/'+id+'?room='+r.headers.get('x-rr-room-id'),r.url),302);}

