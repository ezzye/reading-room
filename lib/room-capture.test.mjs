import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { memberAuthAPI, memberAuthGate, roomsAPI } from './member-auth.ts';
import {roomCaptureAPI} from './room-capture.ts';
import {extractNewspaper} from './newspaper-core.mjs';
import { accessiblePage, DEFAULT_ROOM_ID } from './rooms.ts';
import { fixture } from './newspaper-fixture.mjs';

const origin = 'https://reader.example';
const ownerEmail = 'owner@example.org';
const now = Date.now();
const vaultKey = '47'.repeat(32);
const articleURL = 'https://theguardian.com/fictional/room-story';
const migrations = readdirSync(new URL('../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort();

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const name of migrations) sql.exec(readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'));
  return { sql, async batch(statements) { sql.exec('BEGIN'); try { const results = statements.map(statement => statement._run()); sql.exec('COMMIT'); return results; } catch (error) { sql.exec('ROLLBACK'); throw error; } }, prepare(query) { const statement = sql.prepare(query); const wrap = args => ({ _run: () => ({ success: true, meta: { changes: Number(statement.run(...args).changes) } }), first: async () => statement.get(...args) || null, all: async () => ({ results: statement.all(...args) }), run: async () => ({ success: true, meta: { changes: Number(statement.run(...args).changes) } }) }); return { ...wrap([]), bind(...args) { return wrap(args); } }; } };
}
function config(DB, extra = {}) { return { DB, READER_OWNER_EMAIL: ownerEmail, DEEPSEEK_API_KEY: 'synthetic-key', RR_LIBRARY_VAULT_KEY: vaultKey, ...extra }; }
function raw(path, method = 'GET', body, cookie = '', headers = {}) { return new Request(origin + path, { method, headers: { Origin: origin, 'X-Reading-Room': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); }
function cookies(response, previous = '') { const jar = new Map(previous.split(';').filter(Boolean).map(part => part.trim().split('='))); for (const line of response.headers.getSetCookie()) { const [key, value] = line.split(';')[0].split('='); value ? jar.set(key, value) : jar.delete(key); } return [...jar].map(([key, value]) => key + '=' + value).join('; '); }
async function bootstrap(DB) { const response = await memberAuthAPI(raw('/api/member-auth?action=bootstrap', 'POST', {}, '', { 'oai-authenticated-user-email': ownerEmail }), config(DB, { RR_TRUST_SITES_BOOTSTRAP: '1' }), now); assert.equal(response.status, 201); return cookies(response); }
async function room(DB, cookie, name) { const response = await roomsAPI(raw('/api/rooms', 'POST', { action: 'create', name }, cookie), config(DB), now); assert.equal(response.status, 201); return { cookie: cookies(response, cookie), id: (await response.json()).room.id }; }
async function gated(DB, cookie, path, method = 'GET', body, headers = {}) { const request = await memberAuthGate(raw(path, method, body, cookie, headers), config(DB), now); assert(request instanceof Request, `${path} must pass session gate`); assert(request.headers.get('x-ret-member-id')); assert(request.headers.get('x-rr-room-id')); return request; }
function provider() {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === 'https://api.deepseek.com/chat/completions') return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ annotations: [{ blockId: 'B1', title: 'Sequence', comment: 'Consider how the writer leads with the meeting.', question: 'Which perspective is foregrounded?' }, { blockId: 'B3', title: 'Evidence', comment: 'The passage offers a viewpoint for comparison.', question: 'What more would you want to ask?' }] }) } }] });
    if (url === 'https://api.deepseek.com/v1/tools/search') return Response.json({ results: [
      { url: 'https://www.thetimes.com/uk/article/real-article-abcdefghi', title: '<img src=x onerror=alert(1)>' },
      { url: 'https://www.theguardian.com/uk-news/another', title: 'Other paper' },
      { url: 'https://google.com/url?q=https://www.thetimes.com/uk/article/wrapper', title: 'Search wrapper' },
      { url: 'javascript:alert(1)', title: 'Unsafe URL' },
    ] });
    return new Response(fixture, { headers: { 'Content-Type': 'text/html' } });
  };
  return { fetcher, calls };
}


test('review capture imports only into the selected nondefault room and cannot leak to another room',async()=>{
 const DB=database(),owner=await bootstrap(DB),second=await room(DB,owner,'Capture room'),p=provider(),capture=extractNewspaper(fixture,articleURL);
 const response=await roomCaptureAPI(await gated(DB,second.cookie,'/api/room-capture','POST',{capture,requestId:crypto.randomUUID()}),config(DB),p.fetcher),data=await response.json();
 assert.equal(response.status,200,JSON.stringify(data));assert.equal(data.href,'/read/'+data.id+'?room='+second.id);assert.equal(await accessiblePage(await gated(DB,owner,'/api/room-articles'),config(DB),data.id),false);assert.equal(await accessiblePage(await gated(DB,second.cookie,'/api/room-articles'),config(DB),data.id),true);
});
test('capture imports reject absent room, cross-origin writes, short previews and explicit access gates without provider use',async()=>{
 const DB=database(),owner=await bootstrap(DB);let calls=0;const fetcher=async()=>{calls++;throw Error('No call expected');};const capture=extractNewspaper(fixture,articleURL);
 assert.equal((await roomCaptureAPI(raw('/api/room-capture','POST',{}),config(DB),fetcher)).status,401);
 for(const [value,headers,status] of [[capture,{Origin:'https://evil.example'},403],[{...capture,blocks:[{type:'paragraph',text:'Preview only'}]}, {},400],[{...capture,diagnostics:{accessBlocked:true}}, {},400],[{...capture,blocks:[{type:'paragraph',text:'Subscribe to continue reading this article'}]}, {},400]]){
 const request=await gated(DB,owner,'/api/room-capture','POST',{capture:value,requestId:crypto.randomUUID()},headers);assert.equal((await roomCaptureAPI(request,config(DB),fetcher)).status,status);
 }assert.equal(calls,0);
});
