import {env} from 'cloudflare:workers';
import {articleSearchAPI} from '../../../lib/room-articles';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const POST=(r:Request)=>articleSearchAPI(r,env as unknown as Config);
