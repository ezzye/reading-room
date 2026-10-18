import {env} from 'cloudflare:workers';
import {libraryRecordImportAPI} from '../../../../lib/library-record-import';
import type {Config} from '../../../../lib/education-service';
export const dynamic='force-dynamic';
export const POST=(r:Request)=>libraryRecordImportAPI(r,env as unknown as Config);
