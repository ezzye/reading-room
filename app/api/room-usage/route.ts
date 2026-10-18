import {env} from 'cloudflare:workers';
import {roomUsageAPI} from '../../../lib/import-allowance';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>roomUsageAPI(request,env as unknown as Config);
