export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const destination = new URL("/study", url.origin);
  destination.search = url.search;
  return Response.redirect(destination, 302);
}
