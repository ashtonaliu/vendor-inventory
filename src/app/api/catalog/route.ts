import type { NextRequest } from "next/server";
import { searchCatalog } from "@/lib/queries";

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  if (!query.trim()) return Response.json([]);
  return Response.json(await searchCatalog(query));
}
