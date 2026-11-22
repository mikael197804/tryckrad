import type { AppUser, SessionPayload } from "./types";

/** Enda huvudpersonen – kan inte ersättas eller skapas om. */
export const OWNER_ID = "usr_mikael";
export const OWNER_NAME = "Mikael";

export function isOwnerUser(user: Pick<AppUser, "id" | "name"> | null | undefined): boolean {
  if (!user) return false;
  return user.id === OWNER_ID || user.name.trim().toLowerCase() === OWNER_NAME.toLowerCase();
}

export function isOwnerSession(session: SessionPayload | null | undefined): boolean {
  if (!session) return false;
  return session.uid === OWNER_ID || session.name.trim().toLowerCase() === OWNER_NAME.toLowerCase();
}

export function assertNotOwnerName(name: string) {
  if (name.trim().toLowerCase() === OWNER_NAME.toLowerCase()) {
    throw new Error("Namnet Mikael är reserverat för huvudkontot");
  }
}
