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
};

export type PublicUser = {
  id: string;
  name: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  isOwner?: boolean;
  sessionVersion?: number;
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
  const isOwner =
    u.id === "usr_mikael" || u.name.trim().toLowerCase() === "mikael";
  return {
    id: u.id,
    name: u.name,
    role: isOwner ? "admin" : u.role,
    active: u.active,
    createdAt: u.createdAt,
    isOwner,
    sessionVersion: u.sessionVersion ?? 0,
  };
}
