import {env} from 'cloudflare:workers';
import {roomSourceCleanupAPI} from '../../../lib/room-source-cleanup';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const POST=(request:Request)=>roomSourceCleanupAPI(request,env as unknown as Config);
