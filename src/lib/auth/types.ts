export type UserRole = "admin" | "user";

export type AppUser = {
  id: string;
  name: string;
  role: UserRole;
  active: boolean;
  passwordHash: string;
  createdAt: string;
  /** Ökas när ägaren sparkar ut – gamla sessioner dör. */
  sessionVersion?: number;
  /** Betald access giltig till (ISO). Saknas/utgången = ingen access (utom ägare). */
  accessUntil?: string | null;
};

export type PublicUser = {
  id: string;
  name: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  isOwner?: boolean;
  sessionVersion?: number;
  accessUntil?: string | null;
  accessActive?: boolean;
};

export type SessionPayload = {
  uid: string;
  name: string;
  role: UserRole;
  exp: number;
  /** Matchar AppUser.sessionVersion */
  sv?: number;
};

export function toPublicUser(u: AppUser): PublicUser {
  const isOwner = u.id === "usr_mikael";
  const until = u.accessUntil || null;
  const accessActive =
    isOwner ||
    (!!until && Number.isFinite(Date.parse(until)) && Date.parse(until) > Date.now());
  return {
    id: u.id,
    name: u.name,
    role: isOwner ? "admin" : "user",
    active: u.active,
    createdAt: u.createdAt,
    isOwner,
    sessionVersion: u.sessionVersion ?? 0,
    accessUntil: until,
    accessActive,
  };
}
