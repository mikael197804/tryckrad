import { NextRequest, NextResponse } from "next/server";
import { generatePassword } from "../../../../lib/auth/password";
import { readSessionFromRequest } from "../../../../lib/auth/session";
import {
  createUser,
  listUsers,
  removeUser,
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

function storeTokenFrom(req: NextRequest): string | null {
  return (
    req.headers.get("x-user-store-token")?.trim() ||
    req.headers.get("x-github-token")?.trim() ||
    null
  );
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
  const storeToken = storeTokenFrom(req);

  try {
    const result = await createUser(
      {
        name: body.name || "",
        password,
        role: body.role === "admin" ? "admin" : "user",
      },
      storeToken
    );
    return NextResponse.json({
      user: toPublicUser(result.user),
      password,
      persisted: result.persisted,
      persistError: result.persistError || null,
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

  const storeToken = storeTokenFrom(req);

  try {
    if (typeof body.active === "boolean") {
      const result = await setUserActive(body.id, body.active, storeToken);
      return NextResponse.json({
        user: toPublicUser(result.user),
        persisted: result.persisted,
        persistError: result.persistError || null,
      });
    }
    if (body.resetPassword) {
      const password = body.password || generatePassword();
      const result = await resetUserPassword(body.id, password, storeToken);
      return NextResponse.json({
        user: toPublicUser(result.user),
        password,
        persisted: result.persisted,
        persistError: result.persistError || null,
      });
    }
    return NextResponse.json({ error: "Inget att uppdatera" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Kunde inte uppdatera" },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Endast admin" }, { status: 403 });
  }

  let body: { id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Ogiltig begäran" }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: "Saknar id" }, { status: 400 });
  }

  try {
    const result = await removeUser(body.id, storeTokenFrom(req));
    return NextResponse.json({
      ok: true,
      persisted: result.persisted,
      persistError: result.persistError || null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Kunde inte ta bort" },
      { status: 400 }
    );
  }
}
