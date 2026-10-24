import html from '../../lib/camden-resources.html?raw';
import script from '../../lib/camden-resources-client.mjs?raw';
export const dynamic='force-dynamic';
export async function GET(){return new Response(html.replace('<!-- CAMDEN_RESOURCES_SCRIPT -->','<script>'+script+'</script>'),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"}});}
