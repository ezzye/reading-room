import {env} from 'cloudflare:workers';
import {roomReader} from '../../../lib/room-reader';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const GET=(r:Request)=>roomReader(r,env as unknown as Config);
