import { NextResponse } from "next/server";
import { getProvider, setProvider, type Provider } from "@/lib/provider";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ provider: await getProvider() });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { provider?: Provider } | null;
  if (body?.provider !== "local" && body?.provider !== "openai") {
    return NextResponse.json({ error: "Provider must be local or openai." }, { status: 400 });
  }
  if (body.provider === "openai" && !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 400 });
  }
  await setProvider(body.provider);
  return NextResponse.json({ ok: true, provider: body.provider });
}
