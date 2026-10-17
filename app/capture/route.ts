export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const destination = new URL("/study", url.origin);
  destination.search = url.search;
  destination.searchParams.set("action", "add");
  return Response.redirect(destination, 302);
}
