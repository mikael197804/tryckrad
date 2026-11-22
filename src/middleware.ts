import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  verifySessionToken,
} from "./lib/auth/session";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|audio/|.*\\.(?:mp3|m4a|wav|ogg|jpg|jpeg|png|webp|svg|ico)$).*)",
  ],
};

function isPublicPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/api/auth/login")) return true;
  if (pathname.startsWith("/audio/")) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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

  const res = NextResponse.next();
  res.headers.set("x-user-name", encodeURIComponent(session.name));
  res.headers.set("x-user-role", session.role);
  res.headers.set("x-user-id", session.uid);
  return res;
}
