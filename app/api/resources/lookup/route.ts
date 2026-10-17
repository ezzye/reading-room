import {env} from 'cloudflare:workers';
import {resourceLookupAPI} from '../../../../lib/resource-service';
import type {Config} from '../../../../lib/education-service';
export const dynamic='force-dynamic';
export const POST=(r:Request)=>resourceLookupAPI(r,env as unknown as Config);
