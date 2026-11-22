import { NextRequest, NextResponse } from "next/server";
import {
  clientIpFromHeaders,
  listVisits,
  recordVisit,
  rememberStoreToken,
} from "../../../../lib/auth/visits";
import { requireOwner, requireUser } from "../../../../lib/auth/require";

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
  const token = storeTokenFrom(req);
  if (token) await rememberStoreToken(token);
  const visits = await listVisits(150, token);
  return NextResponse.json({
    visits,
    generatedAt: new Date().toISOString(),
  });
}

/** Beacon från appen – loggar IP för inloggad användare */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth instanceof NextResponse) return auth;
  const session = auth.session;

  let pathName = "/";
  try {
    const body = (await req.json()) as { path?: string };
    if (body.path && typeof body.path === "string") {
      pathName = body.path.slice(0, 200);
    }
  } catch {
    /* ignore */
  }

  const token = storeTokenFrom(req);
  const ip = clientIpFromHeaders(req.headers);
  await recordVisit({
    ip,
    userName: session.name,
    userId: session.uid,
    path: pathName,
    kind: "view",
    userAgent: req.headers.get("user-agent"),
    storeToken: token,
  });

  if (session.role === "admin") {
    return NextResponse.json({ ok: true, ip });
  }
  return NextResponse.json({ ok: true });
}
