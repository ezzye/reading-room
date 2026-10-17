import html from "../../lib/room-shell.html?raw";
import script from "../../lib/room-reader-shell.mjs?raw";

export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(html.replace("<!-- ROOM_SHELL_SCRIPT -->", `<script>${script}</script>`), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
    },
  });
}
