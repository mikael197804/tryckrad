export type UserRole = "admin" | "user";

export type AppUser = {
  id: string;
  name: string;
  role: UserRole;
  active: boolean;
  passwordHash: string;
  createdAt: string;
};

export type PublicUser = {
  id: string;
  name: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
};

export type SessionPayload = {
  uid: string;
  name: string;
  role: UserRole;
  exp: number;
};

export function toPublicUser(u: AppUser): PublicUser {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    active: u.active,
    createdAt: u.createdAt,
  };
}
