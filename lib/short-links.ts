import { sessionMember, type MemberAuthEnv } from './member-auth.ts';

const CODE = /^[A-Za-z0-9_-]{16}$/;
const PAGE = /^[a-f0-9]{48}$/;
const ROOM = /^[A-Za-z0-9_-]{1,80}$/;
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const missing = () => json({ error: 'Article link is unavailable.' }, 404);

// A code locates an article; it never grants membership or carries an external URL.
const authorizedLink = `SELECT l.code,l.room_id,l.page_id FROM rr_article_links l
  JOIN rr_room_articles a ON a.room_id=l.room_id AND a.page_id=l.page_id
  JOIN education_pages p ON p.id=a.page_id
  JOIN rr_rooms r ON r.id=a.room_id
  JOIN rr_room_members rm ON rm.room_id=a.room_id
  JOIN rr_members m ON m.id=rm.member_id
  WHERE rm.member_id=? AND rm.revoked_at IS NULL AND m.revoked_at IS NULL`;
type ArticleLink = { code: string; room_id: string; page_id: string };
function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.body || Number(request.headers.get('content-length') || 0) > 1024) return null;
  const reader = request.body.getReader();
  try {
    let text = '', length = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body: unknown = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch { return null; } finally { reader.releaseLock(); }
}

export async function roomLinksAPI(request: Request, env: MemberAuthEnv, now = Date.now()): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Same-origin request required.' }, 403);
  try {
    const member = await sessionMember(request, env, now);
    if (!member) return json({ error: 'Sign in to share an article.' }, 401);
    const body = await readBody(request);
    const id = typeof body?.id === 'string' ? body.id : '';
    const room = typeof body?.roomId === 'string' ? body.roomId : '';
    if (!PAGE.test(id) || !ROOM.test(room)) return json({ error: 'Choose an article and room.' }, 400);
    const allowed = await env.DB.prepare(`SELECT 1 AS found FROM rr_room_articles a
      JOIN education_pages p ON p.id=a.page_id JOIN rr_rooms r ON r.id=a.room_id
      JOIN rr_room_members rm ON rm.room_id=a.room_id JOIN rr_members m ON m.id=rm.member_id
      WHERE a.room_id=? AND a.page_id=? AND rm.member_id=? AND rm.revoked_at IS NULL AND m.revoked_at IS NULL`)
      .bind(room, id, member.id).first();
    if (!allowed) return missing();
    for (let attempt = 0; attempt < 3; attempt++) {
      // The INSERT checks access again, bounding storage to one live room/article pair.
      // ON CONFLICT also safely handles concurrent creates and a random-code collision.
      await env.DB.prepare(`INSERT INTO rr_article_links(code,room_id,page_id,created_at)
        SELECT ?,a.room_id,a.page_id,? FROM rr_room_articles a
        JOIN rr_room_members rm ON rm.room_id=a.room_id JOIN rr_members m ON m.id=rm.member_id
        WHERE a.room_id=? AND a.page_id=? AND rm.member_id=? AND rm.revoked_at IS NULL AND m.revoked_at IS NULL
        ON CONFLICT DO NOTHING`).bind(randomCode(), new Date(now).toISOString(), room, id, member.id).run();
      const link = await env.DB.prepare(authorizedLink + ' AND l.room_id=? AND l.page_id=?').bind(member.id, room, id).first<ArticleLink>();
      if (link) return json({ path: '/r/' + link.code });
    }
    return json({ error: 'Article link is temporarily unavailable.' }, 503);
  } catch { return json({ error: 'Article link is temporarily unavailable.' }, 503); }
}

/** Must run before the worker's active-room gate: target membership is checked here. */
export async function resolveRoomLink(request: Request, env: MemberAuthEnv, now = Date.now()): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed.' }, 405);
  const url = new URL(request.url), code = url.pathname.slice(3);
  if (!url.pathname.startsWith('/r/') || !CODE.test(code)) return missing();
  try {
    const member = await sessionMember(request, env, now);
    if (!member) {
      // Resume the opaque path after sign-in; no incoming query is forwarded.
      return new Response(null, { status: 302, headers: { ...headers, Location: '/room?next=' + encodeURIComponent('/r/' + code) } });
    }
    const link = await env.DB.prepare(authorizedLink + ' AND l.code=?').bind(member.id, code).first<ArticleLink>();
    if (!link) return missing();
    return new Response(null, { status: 302, headers: { ...headers, Location: '/read/' + encodeURIComponent(link.page_id) + '?room=' + encodeURIComponent(link.room_id) } });
  } catch { return json({ error: 'Article link is temporarily unavailable.' }, 503); }
}
