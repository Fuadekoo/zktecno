'use client';

import { createContext, useContext } from 'react';

export type Role = 'admin' | 'viewer';

export interface CurrentUser {
  id: number;
  username: string;
  full_name: string | null;
  role: Role;
}

export const UserContext = createContext<CurrentUser | null>(null);

export function useUser() {
  const user = useContext(UserContext);
  return { user, isAdmin: user?.role === 'admin' };
}
