import {env} from 'cloudflare:workers';
import {privateAssetResponse} from '../../../lib/private-assets';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
const handler=(request:Request)=>privateAssetResponse(request,new URL(request.url).pathname.split('/').at(-1)||'',env as unknown as Config);
export const GET=handler;
export const HEAD=handler;
