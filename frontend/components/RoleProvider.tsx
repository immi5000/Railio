"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  getRoleCookie,
  setRoleCookie as writeRoleCookie,
  type Role,
} from "@/lib/role";

const ROLE_CHANGE = "railio-role-change";

type RoleContextValue = {
  role: Role;
  setRole: (role: Role) => void;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>("tech");

  useEffect(() => {
    setRoleState(getRoleCookie() || "tech");
  }, []);

  useEffect(() => {
    function onRoleChange(ev: Event) {
      const next = (ev as CustomEvent<Role>).detail;
      if (next === "tech" || next === "dispatcher") setRoleState(next);
    }
    window.addEventListener(ROLE_CHANGE, onRoleChange);
    return () => window.removeEventListener(ROLE_CHANGE, onRoleChange);
  }, []);

  const setRole = useCallback((next: Role) => {
    writeRoleCookie(next);
    setRoleState(next);
  }, []);

  return (
    <RoleContext.Provider value={{ role, setRole }}>{children}</RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
