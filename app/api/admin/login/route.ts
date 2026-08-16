import { NextResponse } from "next/server";

import { adminCookie, createSession } from "@/lib/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const configured = process.env.ADMIN_PASSWORD;

  if (!configured) {
    return NextResponse.json(
      {
        error: "ADMIN_PASSWORD is not configured.",
      },
      {
        status: 503,
      },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    password?: string;
  } | null;

  if (!body?.password || body.password !== configured) {
    return NextResponse.json(
      {
        error: "Invalid password.",
      },
      {
        status: 401,
      },
    );
  }

  const response = NextResponse.json({
    ok: true,
  });

  response.cookies.set(adminCookie.name, createSession(), adminCookie);

  return response;
}
