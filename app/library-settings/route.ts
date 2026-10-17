import html from '../../lib/library-settings.html?raw';
export const dynamic='force-dynamic';
export const GET=()=>new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
