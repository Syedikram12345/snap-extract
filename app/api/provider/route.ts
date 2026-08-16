import { NextResponse } from "next/server";
import { getProvider } from "@/lib/provider";
export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json({ provider: await getProvider() }, { headers: { "Cache-Control": "no-store" } });
}
