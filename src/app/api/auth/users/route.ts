import { NextRequest, NextResponse } from "next/server";
import { generatePassword } from "../../../../lib/auth/password";
import {
  createUser,
  listUsers,
  removeUser,
  resetUserPassword,
  setUserActive,
  kickUserSession,
  kickAndBan,
} from "../../../../lib/auth/users";
import { toPublicUser } from "../../../../lib/auth/types";
import { requireOwner } from "../../../../lib/auth/require";
import { isOwnerUser } from "../../../../lib/auth/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function storeTokenFrom(req: NextRequest): string | null {
  return (
    req.headers.get("x-user-store-token")?.trim() ||
    req.headers.get("x-github-token")?.trim() ||
    null
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;
  const users = await listUsers();
  return NextResponse.json({
    users: users.map(toPublicUser),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;

  let body: {
    name?: string;
    password?: string;
    autoPassword?: boolean;
    accessDays?: number;
    action?: string;
    id?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Ogiltig begäran" }, { status: 400 });
  }

  const storeToken = storeTokenFrom(req);

  // Kick via samma endpoint
  if (body.action === "kick" && body.id) {
    try {
      const result = await kickUserSession(body.id, storeToken);
      return NextResponse.json({
        user: toPublicUser(result.user),
        kicked: true,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Kunde inte sparka ut" },
        { status: 400 }
      );
    }
  }
  if (body.action === "kick_ban" && body.id) {
    try {
      const result = await kickAndBan(body.id, storeToken);
      return NextResponse.json({
        user: toPublicUser(result.user),
        kicked: true,
        banned: true,
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Kunde inte stänga av" },
        { status: 400 }
      );
    }
  }

  const password =
    body.autoPassword || !body.password ? generatePassword() : body.password;

  try {
    const result = await createUser(
      {
        name: body.name || "",
        password,
        role: "user",
        accessDays: body.accessDays ?? 7,
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
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;

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
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;

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
    // Kick before remove so active sessions die
    const target = (await listUsers()).find((u) => u.id === body.id);
    if (target && !isOwnerUser(target)) {
      await kickUserSession(body.id, storeTokenFrom(req)).catch(() => null);
    }
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
