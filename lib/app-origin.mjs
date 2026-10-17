// Derive shared links from the current trusted request origin.
export function canonicalOrigin(raw){return new URL(raw).origin;}
export function shareURL(token,raw){return new URL('/s/'+token,canonicalOrigin(raw)).href;}
export function sameRETOrigin(a,b){return new URL(a).origin===new URL(b).origin;}
