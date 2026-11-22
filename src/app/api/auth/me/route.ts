import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookieHeader } from "../../../../lib/auth/session";
import { requireUser } from "../../../../lib/auth/require";
import { toPublicUser } from "../../../../lib/auth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth instanceof NextResponse) {
    // Rensa cookie om sparkad
    const body = await auth.clone().json().catch(() => ({}));
    if ((body as { code?: string }).code === "kicked") {
      const res = NextResponse.json(body, { status: 401 });
      res.headers.set("Set-Cookie", clearSessionCookieHeader());
      return res;
    }
    return auth;
  }
  return NextResponse.json({ user: toPublicUser(auth.user) });
}
