import {env} from 'cloudflare:workers';
import {pressAuditAPI} from '../../../../lib/press-audit';
import type {Config} from '../../../../lib/education-service';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>pressAuditAPI(request,env as unknown as Config);
export const POST=GET;
