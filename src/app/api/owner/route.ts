import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "../../../lib/auth/require";
import {
  kickAndBan,
  kickUserSession,
  listUsers,
  setUserAccessUntil,
} from "../../../lib/auth/users";
import { toPublicUser } from "../../../lib/auth/types";
import { listVisits } from "../../../lib/auth/visits";
import {
  ownerSummary,
  registerDayPayment,
  setPricePerDay,
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
    userName?: string;
    days?: number;
    amountKr?: number;
    note?: string;
    pricePerDayKr?: number;
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

    if (action === "set_price") {
      const settings = await setPricePerDay(Number(body.pricePerDayKr));
      const summary = await ownerSummary();
      return NextResponse.json({
        ok: true,
        pricePerDayKr: settings.pricePerDayKr,
        summary,
      });
    }

    if (action === "register_days") {
      if (!body.userId || !body.userName) throw new Error("Saknar användare");
      const users = await listUsers();
      const target = users.find((u) => u.id === body.userId);
      if (!target) throw new Error("Användaren hittades inte");

      const { payment, accessUntil } = await registerDayPayment({
        userId: body.userId,
        userName: body.userName,
        days: Number(body.days),
        amountKr: body.amountKr,
        currentAccessUntil: target.accessUntil,
        note: body.note,
      });
      const updated = await setUserAccessUntil(
        body.userId,
        accessUntil,
        token
      );
      const summary = await ownerSummary();
      return NextResponse.json({
        ok: true,
        payment,
        user: toPublicUser(updated.user),
        summary,
        message: `${body.userName} har access till ${new Date(accessUntil).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}`,
      });
    }

    return NextResponse.json({ error: "Okänd action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fel" },
      { status: 400 }
    );
  }
}
