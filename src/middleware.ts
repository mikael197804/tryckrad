import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  verifySessionToken,
} from "./lib/auth/session";
import { isOwnerSession } from "./lib/auth/owner";
import { isSwedenAllowed, requestCountry } from "./lib/geo";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|audio/|demo/|.*\\.(?:mp3|m4a|mp4|wav|ogg|jpg|jpeg|png|webp|svg|ico)$).*)",
  ],
};

function isPublicPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/api/auth/login")) return true;
  if (pathname.startsWith("/audio/")) return true;
  if (pathname.startsWith("/demo/")) return true;
  return false;
}

function swedenOnlyBlocked(req: NextRequest): NextResponse {
  const country = requestCountry(req) || "okänt";
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: "Sidan är endast tillgänglig från Sverige.",
        code: "sweden_only",
        country,
      },
      { status: 403 }
    );
  }
  const html = `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Endast Sverige · Mikael’s tips</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;
      font-family:Georgia,"Times New Roman",serif;background:#0f1410;color:#e8efe6}
    main{max-width:28rem;padding:2rem;text-align:center}
    h1{font-size:1.6rem;margin:0 0 .75rem}
    p{margin:0;line-height:1.5;opacity:.88}
  </style>
</head>
<body>
  <main>
    <h1>Endast Sverige</h1>
    <p>Den här webbsidan är låst till Sverige och kan inte öppnas från ditt land (${country}).</p>
  </main>
</body>
</html>`;
  return new NextResponse(html, {
    status: 403,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "x-geo-country": country,
    },
  });
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Lås hela sajten till Sverige (Vercel edge geo)
  if (!isSwedenAllowed(req)) {
    return swedenOnlyBlocked(req);
  }

  // Statiska ljud-/videofiler får aldrig skickas till login
  if (
    pathname.startsWith("/audio/") ||
    pathname.startsWith("/demo/") ||
    /\.(?:mp3|m4a|mp4|wav|ogg)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    // Redan inloggad → skicka hem från login
    if (pathname === "/login") {
      const token = req.cookies.get(SESSION_COOKIE)?.value;
      const session = await verifySessionToken(token);
      if (session) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Inloggning krävs" },
        { status: 401 }
      );
    }
    const login = new URL("/login", req.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // Inbjudna får bara spel – inte medlemmar / kontroll / behörighet
  if (
    (pathname === "/owner" ||
      pathname.startsWith("/owner/") ||
      pathname.startsWith("/api/owner") ||
      pathname.startsWith("/api/auth/users")) &&
    !isOwnerSession(session)
  ) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Endast huvudkontot (Mikael) har access hit" },
        { status: 403 }
      );
    }
    return NextResponse.redirect(new URL("/", req.url));
  }

  // GET visits är ägare-only; POST (beacon) får alla inloggade göra
  if (
    pathname.startsWith("/api/auth/visits") &&
    req.method === "GET" &&
    !isOwnerSession(session)
  ) {
    return NextResponse.json(
      { error: "Endast huvudkontot (Mikael) har access hit" },
      { status: 403 }
    );
  }

  const res = NextResponse.next();
  res.headers.set("x-user-name", encodeURIComponent(session.name));
  res.headers.set("x-user-role", session.role);
  res.headers.set("x-user-id", session.uid);
  return res;
}
