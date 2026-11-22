import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  verifySessionToken,
} from "./lib/auth/session";
import { isOwnerSession } from "./lib/auth/owner";

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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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
