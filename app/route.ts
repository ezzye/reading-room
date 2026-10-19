import html from "../lib/welcome.html?raw";
import invitationScript from "../lib/welcome-link.mjs?raw";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Older article links still pass through the private study route.
  if (url.searchParams.get("action") === "add" || ["url", "article", "text", "room"].some(key => url.searchParams.has(key))) {
    const destination = new URL("/study", url.origin);
    destination.search = url.search;
    return new Response(null, { status: 302, headers: { Location: destination.toString(), "Cache-Control": "no-store" } });
  }
  return new Response(html.replace("import { invitationDestination } from './welcome-link.mjs';", invitationScript), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}
