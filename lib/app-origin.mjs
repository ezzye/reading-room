export const APP_ORIGIN='https://dayofflondon.com';
const hosts=new Set(['dayofflondon.com','www.dayofflondon.com','legacy.reader.example.org']);
// Only these deployed HTTPS origins share the production link destination.
// Keep local previews, unrelated deployments and lookalike hosts on their own origin.
export function canonicalOrigin(raw){const u=new URL(raw);return ['https://dayofflondon.com','https://www.dayofflondon.com','https://legacy.reader.example.org'].includes(u.origin)?APP_ORIGIN:u.origin;}
export function shareURL(token,raw){return new URL('/s/'+token,canonicalOrigin(raw)).href;}
export function sameRETOrigin(a,b){const x=new URL(a),y=new URL(b);return x.origin===y.origin||(x.protocol==='https:'&&y.protocol==='https:'&&hosts.has(x.hostname)&&hosts.has(y.hostname));}
