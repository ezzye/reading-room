import {discover} from "../../../lib/news-api";
export const dynamic="force-dynamic";
// Public read-only lookup. Fixed upstream endpoints; no user article text or account credentials are accepted.
export async function GET(request:Request){return discover(request);}
