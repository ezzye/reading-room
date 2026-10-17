import {env} from 'cloudflare:workers';
import {articleAPI} from '../../../lib/article-service';
import type {Config} from '../../../lib/education-service';
export const dynamic='force-dynamic';
export const POST=(r:Request)=>articleAPI(r,env as unknown as Config);
