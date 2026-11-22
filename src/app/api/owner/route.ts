import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "../../../lib/auth/require";
import {
  kickAndBan,
  kickUserSession,
  listUsers,
} from "../../../lib/auth/users";
import { toPublicUser } from "../../../lib/auth/types";
import { listVisits } from "../../../lib/auth/visits";
import {
  markCommissionPaid,
  ownerSummary,
  registerWin,
  setCommissionPercent,
} from "../../../lib/auth/ledger";
import { isOwnerUser } from "../../../lib/auth/owner";

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

  const [users, summary, visits] = await Promise.all([
    listUsers(),
    ownerSummary(),
    listVisits(80, storeTokenFrom(req)),
  ]);

  return NextResponse.json({
    owner: toPublicUser(auth.user),
    users: users.filter((u) => !isOwnerUser(u)).map(toPublicUser),
    summary,
    visits,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireOwner(req);
  if (auth instanceof NextResponse) return auth;

  let body: {
    action?: string;
    userId?: string;
    winKr?: number;
    note?: string;
    userName?: string;
    percent?: number;
    entryId?: string;
    paid?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Ogiltig begäran" }, { status: 400 });
  }

  const token = storeTokenFrom(req);
  const action = body.action || "";

  try {
    if (action === "kick") {
      if (!body.userId) throw new Error("Saknar userId");
      const result = await kickUserSession(body.userId, token);
      return NextResponse.json({
        ok: true,
        user: toPublicUser(result.user),
        message: "Användaren är utsparkad (måste logga in igen)",
      });
    }

    if (action === "kick_ban") {
      if (!body.userId) throw new Error("Saknar userId");
      const result = await kickAndBan(body.userId, token);
      return NextResponse.json({
        ok: true,
        user: toPublicUser(result.user),
        message: "Utsparkad och avstängd",
      });
    }

    if (action === "register_win") {
      if (!body.userId || !body.userName) throw new Error("Saknar användare");
      const entry = await registerWin({
        userId: body.userId,
        userName: body.userName,
        winKr: Number(body.winKr),
        note: body.note,
      });
      const summary = await ownerSummary();
      return NextResponse.json({ ok: true, entry, summary });
    }

    if (action === "set_percent") {
      const settings = await setCommissionPercent(Number(body.percent));
      const summary = await ownerSummary();
      return NextResponse.json({
        ok: true,
        commissionPercent: settings.commissionPercent,
        summary,
      });
    }

    if (action === "mark_paid") {
      if (!body.entryId) throw new Error("Saknar entryId");
      const entry = await markCommissionPaid(
        body.entryId,
        body.paid !== false
      );
      const summary = await ownerSummary();
      return NextResponse.json({ ok: true, entry, summary });
    }

    return NextResponse.json({ error: "Okänd action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fel" },
      { status: 400 }
    );
  }
}
