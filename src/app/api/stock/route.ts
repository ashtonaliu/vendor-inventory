import type { NextRequest } from "next/server";
import { searchStock } from "@/lib/queries";

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  return Response.json(await searchStock(query));
}
