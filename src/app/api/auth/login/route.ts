import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "../../../../lib/auth/password";
import {
  createSessionToken,
  sessionCookieHeader,
} from "../../../../lib/auth/session";
import { findUserByName } from "../../../../lib/auth/users";
import { toPublicUser } from "../../../../lib/auth/types";
import {
  clientIpFromHeaders,
  recordVisit,
} from "../../../../lib/auth/visits";
import { isOwnerUser } from "../../../../lib/auth/owner";
import { hasPaidAccess } from "../../../../lib/auth/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { name?: string; password?: string };
  try {
    body = (await req.json()) as { name?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Ogiltig begäran" }, { status: 400 });
  }

  const name = (body.name || "").trim();
  const password = body.password || "";
  const ip = clientIpFromHeaders(req.headers);
  const ua = req.headers.get("user-agent");

  if (!name || !password) {
    return NextResponse.json(
      { error: "Ange namn och lösenord" },
      { status: 400 }
    );
  }

  const user = await findUserByName(name);
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    await recordVisit({
      ip,
      userName: name || null,
      userId: null,
      path: "/login",
      kind: "login_fail",
      userAgent: ua,
    });
    return NextResponse.json(
      { error: "Fel namn eller lösenord" },
      { status: 401 }
    );
  }

  if (!isOwnerUser(user) && !hasPaidAccess(user.accessUntil)) {
    await recordVisit({
      ip,
      userName: user.name,
      userId: user.id,
      path: "/login",
      kind: "login_fail",
      userAgent: ua,
    });
    return NextResponse.json(
      {
        error:
          "Ingen betald dag kvar. Betala dygnsavgiften till Mikael för att komma in.",
        code: "payment_required",
      },
      { status: 403 }
    );
  }

  await recordVisit({
    ip,
    userName: user.name,
    userId: user.id,
    path: "/login",
    kind: "login",
    userAgent: ua,
  });

  const token = await createSessionToken(user);
  const res = NextResponse.json({
    ok: true,
    user: toPublicUser(user),
  });
  res.headers.set("Set-Cookie", sessionCookieHeader(token));
  return res;
}
