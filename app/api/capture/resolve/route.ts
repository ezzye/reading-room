import {env} from 'cloudflare:workers';
import {resolveCaptureAPI} from '../../../../lib/capture-service';
import {Config} from '../../../../lib/education-service';
export const dynamic='force-dynamic';
export const POST=(r:Request)=>resolveCaptureAPI(r,env as unknown as Config);
