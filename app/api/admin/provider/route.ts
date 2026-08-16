import { NextResponse } from "next/server";

import { getProvider, setProvider, type Provider } from "@/lib/provider";

import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";

// ---------------------------------------------------------
// GET CURRENT PROVIDER
// ---------------------------------------------------------

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      {
        error: "Unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  return NextResponse.json(
    {
      provider: await getProvider(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

// ---------------------------------------------------------
// CHANGE PROVIDER
// ---------------------------------------------------------

export async function POST(req: Request) {
  if (!(await requireAdmin())) {
    return NextResponse.json(
      {
        error: "Unauthorized",
      },
      {
        status: 401,
      },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    provider?: Provider;
  } | null;

  if (
    body?.provider !== "local" &&
    body?.provider !== "gemini" &&
    body?.provider !== "openai"
  ) {
    return NextResponse.json(
      {
        error: "Provider must be local, gemini, or openai.",
      },
      {
        status: 400,
      },
    );
  }

  // -------------------------------------------------------
  // GEMINI CHECK
  // -------------------------------------------------------

  if (body.provider === "gemini" && !process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        error: "GEMINI_API_KEY is not configured.",
      },
      {
        status: 400,
      },
    );
  }

  // -------------------------------------------------------
  // OPENAI CHECK
  // -------------------------------------------------------

  if (body.provider === "openai" && !process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error: "OPENAI_API_KEY is not configured.",
      },
      {
        status: 400,
      },
    );
  }

  await setProvider(body.provider);

  return NextResponse.json({
    ok: true,
    provider: body.provider,
  });
}
