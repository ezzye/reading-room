import {env} from 'cloudflare:workers';
import {roomCaptureAPI} from '../../../lib/room-capture';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const POST=(request:Request)=>roomCaptureAPI(request,env as unknown as Config);
