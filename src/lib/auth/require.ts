import { NextRequest, NextResponse } from "next/server";
import { readSessionFromRequest } from "./session";
import { findUserById } from "./users";
import { isOwnerSession, isOwnerUser } from "./owner";
import { hasPaidAccess } from "./ledger";
import type { AppUser, SessionPayload } from "./types";

export type Authed = {
  session: SessionPayload;
  user: AppUser;
};

/**
 * Kräver giltig session som inte sparkats ut (sessionVersion).
 * Vanliga användare måste ha betald dygnsaccess.
 */
export async function requireUser(
  req: NextRequest
): Promise<Authed | NextResponse> {
  const session = await readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Inloggning krävs" }, { status: 401 });
  }
  const user = await findUserById(session.uid);
  if (!user || !user.active) {
    return NextResponse.json(
      { error: "Kontot är avstängt", code: "kicked" },
      { status: 401 }
    );
  }
  const sv = user.sessionVersion ?? 0;
  if ((session.sv ?? 0) !== sv) {
    return NextResponse.json(
      { error: "Du har loggats ut av ägaren", code: "kicked" },
      { status: 401 }
    );
  }
  if (isOwnerUser(user)) {
    user.role = "admin";
  } else if (!hasPaidAccess(user.accessUntil)) {
    return NextResponse.json(
      {
        error: "Ingen betald dag kvar – kontakta Mikael för access",
        code: "payment_required",
      },
      { status: 403 }
    );
  }
  return { session, user };
}

export async function requireOwner(
  req: NextRequest
): Promise<Authed | NextResponse> {
  const session = await readSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: "Inloggning krävs" }, { status: 401 });
  }
  const user = await findUserById(session.uid);
  if (!user || !user.active) {
    return NextResponse.json(
      { error: "Kontot är avstängt", code: "kicked" },
      { status: 401 }
    );
  }
  const sv = user.sessionVersion ?? 0;
  if ((session.sv ?? 0) !== sv) {
    return NextResponse.json(
      { error: "Du har loggats ut av ägaren", code: "kicked" },
      { status: 401 }
    );
  }
  if (!isOwnerSession(session) || !isOwnerUser(user)) {
    return NextResponse.json(
      { error: "Endast huvudkontot (Mikael) har access hit" },
      { status: 403 }
    );
  }
  return { session, user };
}
