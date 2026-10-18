import {env} from 'cloudflare:workers';
import {librarySearchAPI} from '../../../lib/library-search';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const POST=(r:Request)=>librarySearchAPI(r,env as unknown as Config);
