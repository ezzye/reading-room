import {env} from 'cloudflare:workers';
import {headlineCheckAPI} from '../../../lib/headline-check-service';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const POST=(r:Request)=>headlineCheckAPI(r,env as unknown as Config);
