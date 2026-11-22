import type { AppUser, SessionPayload } from "./types";

/**
 * Enda personen som får ändra Mikael’s tips (behörighet, konton, kontroll).
 * Inbjudna får bara spela – aldrig styra.
 */
export const OWNER_ID = "usr_mikael";
export const OWNER_NAME = "Mikael";

export function isOwnerUser(
  user: Pick<AppUser, "id" | "name"> | null | undefined
): boolean {
  if (!user) return false;
  // Huvudkontot identifieras på id – namnet Mikael är dessutom reserverat
  return user.id === OWNER_ID;
}

export function isOwnerSession(
  session: SessionPayload | null | undefined
): boolean {
  if (!session) return false;
  return session.uid === OWNER_ID;
}

export function assertNotOwnerName(name: string) {
  if (name.trim().toLowerCase() === OWNER_NAME.toLowerCase()) {
    throw new Error("Namnet Mikael är reserverat för huvudkontot");
  }
}
