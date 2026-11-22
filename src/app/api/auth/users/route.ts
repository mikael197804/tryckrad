import { NextRequest, NextResponse } from "next/server";
import { generatePassword } from "../../../../lib/auth/password";
import { readSessionFromRequest } from "../../../../lib/auth/session";
import {
  createUser,
  listUsers,
  resetUserPassword,
  setUserActive,
} from "../../../../lib/auth/users";
import { toPublicUser, type UserRole } from "../../../../lib/auth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(req: NextRequest) {
  const session = await readSessionFromRequest(req);
  if (!session || session.role !== "admin") return null;
  return session;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Endast admin" }, { status: 403 });
  }
  const users = await listUsers();
  return NextResponse.json({
    users: users.map(toPublicUser),
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Endast admin" }, { status: 403 });
  }

  let body: {
    name?: string;
    password?: string;
    role?: UserRole;
    autoPassword?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Ogiltig begäran" }, { status: 400 });
  }

  const password =
    body.autoPassword || !body.password ? generatePassword() : body.password;

  try {
    const user = await createUser({
      name: body.name || "",
      password,
      role: body.role === "admin" ? "admin" : "user",
    });
    return NextResponse.json({
      user: toPublicUser(user),
      password,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Kunde inte skapa användare" },
      { status: 400 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Endast admin" }, { status: 403 });
  }

  let body: {
    id?: string;
    active?: boolean;
    resetPassword?: boolean;
    password?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Ogiltig begäran" }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "Saknar id" }, { status: 400 });
  }

  try {
    if (typeof body.active === "boolean") {
      const user = await setUserActive(body.id, body.active);
      return NextResponse.json({ user: toPublicUser(user) });
    }
    if (body.resetPassword) {
      const password = body.password || generatePassword();
      const user = await resetUserPassword(body.id, password);
      return NextResponse.json({ user: toPublicUser(user), password });
    }
    return NextResponse.json({ error: "Inget att uppdatera" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Kunde inte uppdatera" },
      { status: 400 }
    );
  }
}
