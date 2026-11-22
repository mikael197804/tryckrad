import { NextRequest, NextResponse } from "next/server";

/**
 * Enkel inloggning (Basic Auth).
 * Miljövariabler AUTH_USER / AUTH_PASSWORD överskrider inbyggda värden.
 * Lösenordet i klartext ligger inte i repot – bara en hash.
 */
const DEFAULT_USER = "Mikael";
const PASS_SALT = "bc26c2e8c7b4e3eb704e7d24ab9d624f";
const PASS_HASH =
  "261212ecda6106e0cc71c9b73abb1daea18490f3c2ad8bc71084b5b01f15713b";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function unauthorized(): NextResponse {
  return new NextResponse("Inloggning krävs – Mikaels tips", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Mikaels tips", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export async function middleware(req: NextRequest) {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) {
    return unauthorized();
  }

  let decoded = "";
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return unauthorized();
  }

  const colon = decoded.indexOf(":");
  if (colon < 0) return unauthorized();
  const user = decoded.slice(0, colon);
  const pass = decoded.slice(colon + 1);

  const envUser = process.env.AUTH_USER?.trim();
  const envPass = process.env.AUTH_PASSWORD;

  if (envUser && envPass != null && envPass !== "") {
    if (user === envUser && pass === envPass) {
      return NextResponse.next();
    }
    return unauthorized();
  }

  if (user !== DEFAULT_USER) {
    return unauthorized();
  }

  const hash = await sha256Hex(PASS_SALT + pass);
  if (hash !== PASS_HASH) {
    return unauthorized();
  }

  return NextResponse.next();
}
