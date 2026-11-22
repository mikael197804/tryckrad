import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "../../../../lib/auth/session";
import { findUserById } from "../../../../lib/auth/users";
import { toPublicUser } from "../../../../lib/auth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  const user = await findUserById(session.uid);
  if (!user || !user.active) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user: toPublicUser(user) });
}
