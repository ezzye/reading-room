import {env} from 'cloudflare:workers';
import {requestAPI} from '../../../lib/request-service';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const GET=(r:Request)=>requestAPI(r,env as unknown as Config);
export const POST=GET;
