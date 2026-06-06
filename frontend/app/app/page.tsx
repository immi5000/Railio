"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getRoleCookie, setRoleCookie } from "@/lib/role";

// The old role-picker wall is gone — everyone lands in the unified workspace.
// Default to tech if no role has been chosen; the workspace has a quiet role
// toggle. This route just forwards into /work for any old links.
export default function AppRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (!getRoleCookie()) setRoleCookie("tech");
    router.replace("/work");
  }, [router]);
  return null;
}
