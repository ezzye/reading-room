import {env} from "cloudflare:workers";
import {educationAPI,Config} from "../../../lib/education-service";
export const dynamic="force-dynamic";
export const GET=(r:Request)=>educationAPI(r,env as unknown as Config);
export const POST=GET;

