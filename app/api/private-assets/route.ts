import {env} from 'cloudflare:workers';
import {privateAssetsAPI} from '../../../lib/private-assets';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>privateAssetsAPI(request,env as unknown as Config);
export const POST=GET;
