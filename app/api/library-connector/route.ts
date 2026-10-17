import {env} from 'cloudflare:workers';
import {libraryAPI} from '../../../lib/library-connector';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const GET=(r:Request)=>libraryAPI(r,env as unknown as Config);
export const POST=GET;export const OPTIONS=GET;
