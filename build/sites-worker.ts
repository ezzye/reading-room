import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import {memberAuthAPI,memberAuthGate,isPublicMemberAuthPath} from '../lib/member-auth';
import type {MemberAuthEnv} from '../lib/member-auth';
import {roomId,DEFAULT_ROOM_ID} from '../lib/rooms';

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const roomEnv=env as unknown as MemberAuthEnv & {RR_MEMBER_AUTH_MODE?:string,ASSETS?:Fetcher};
    const path=new URL(request.url).pathname;
    if(path==='/api/member-auth')return memberAuthAPI(request,roomEnv);
    if(roomEnv.RR_MEMBER_AUTH_MODE==='enforced'&&!isPublicMemberAuthPath(path)){
      const gated=await memberAuthGate(request,roomEnv);
      if(gated instanceof Response)return gated;
      request=gated;
      // Retained legacy tools and private corpus assets belong to the migrated room.
      // New room owners never inherit access to those global, pre-room records.
      const legacy=/^\/(?:api\/(?:education|capture|resources|requests|library-connector|private-assets|discussion)(?:\/|$)|critical(?:\/|$)|critical-assets(?:\/|$)|private-assets-admin$|library-connector$|(?:ret-corpus|research)\.json$|ret-(?:camden-connector|page-lens-extension)\.zip$|(?:phone|help|unpaywall|subscriptions|read-everything-guide)\.html$|index\.html$)/.test(path);
      if(legacy&&roomId(request)!==DEFAULT_ROOM_ID)return new Response('Not found',{status:404,headers:{'Cache-Control':'private, no-store'}});
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const response=await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
    // Worker-first asset dispatch is essential: source photographs and exported
    // files are private too. The binding cannot be reached before the gate.
    if(response.status===404&&roomEnv.ASSETS){const asset=await roomEnv.ASSETS.fetch(request);if(asset.status!==404){const headers=new Headers(asset.headers);headers.set('Cache-Control','private, no-store');headers.set('X-Robots-Tag','noindex, nofollow');return new Response(asset.body,{status:asset.status,headers});}}
    return response;
  },
};
