'use client';

import { createContext, useContext } from 'react';

export type Role = 'admin' | 'viewer';

export interface CurrentUser {
  id: number;
  username: string;
  full_name: string | null;
  role: Role;
  last_login_at?: string | null;
}

export const UserContext = createContext<CurrentUser | null>(null);
/** Replace the signed-in user's details (after editing the profile). */
export const SetUserContext = createContext<(u: CurrentUser) => void>(() => {});

export function useUser() {
  const user = useContext(UserContext);
  return { user, isAdmin: user?.role === 'admin' };
}

export const useSetUser = () => useContext(SetUserContext);
