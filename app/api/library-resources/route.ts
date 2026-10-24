import {env} from 'cloudflare:workers';
import {camdenResourcesAPI} from '../../../lib/camden-resource-service';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const GET=(r:Request)=>camdenResourcesAPI(r,env as unknown as Config);
export const POST=GET;
