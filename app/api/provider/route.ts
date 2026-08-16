import { NextResponse } from "next/server";

import { getProvider } from "@/lib/provider";

export const runtime = "nodejs";

export async function GET() {
  const provider = await getProvider();

  return NextResponse.json(
    {
      provider,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
