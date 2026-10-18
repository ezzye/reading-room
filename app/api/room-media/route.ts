import {env} from 'cloudflare:workers';
import {roomMediaAPI} from '../../../lib/media-service';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const POST=(r:Request)=>roomMediaAPI(r,env as unknown as Config);
