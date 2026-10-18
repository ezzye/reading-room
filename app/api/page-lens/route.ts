import {env} from 'cloudflare:workers';
import {pageLensAPI} from '../../../lib/page-lens-service';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const GET=(r:Request)=>pageLensAPI(r,env as unknown as Config);
export const POST=GET;
