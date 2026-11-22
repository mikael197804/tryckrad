import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "../../../../lib/auth/password";
import {
  createSessionToken,
  sessionCookieHeader,
} from "../../../../lib/auth/session";
import { findUserByName } from "../../../../lib/auth/users";
import { toPublicUser } from "../../../../lib/auth/types";

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
  if (!name || !password) {
    return NextResponse.json(
      { error: "Ange namn och lösenord" },
      { status: 400 }
    );
  }

  const user = await findUserByName(name);
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json(
      { error: "Fel namn eller lösenord" },
      { status: 401 }
    );
  }

  const token = await createSessionToken(user);
  const res = NextResponse.json({
    ok: true,
    user: toPublicUser(user),
  });
  res.headers.set("Set-Cookie", sessionCookieHeader(token));
  return res;
}
