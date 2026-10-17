import {env} from 'cloudflare:workers';
import {captureAPI} from '../../../lib/capture-service';
import {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const GET=(r:Request)=>captureAPI(r,env as unknown as Config);
export const POST=GET;
