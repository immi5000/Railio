"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getRoleCookie, setRoleCookie } from "@/lib/role";
import { getMe, ApiError } from "@/lib/api";

// Post-login gate: send onboarded users into the workspace, new users through
// onboarding. The DB's profile_completed flag (not the Supabase session) decides,
// so this lives here rather than in middleware.
export default function AppRedirect() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      if (!getRoleCookie()) setRoleCookie("tech");
      try {
        const me = await getMe();
        router.replace(me.profile_completed ? "/work" : "/onboarding");
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) router.replace("/onboarding");
        else router.replace("/signin");
      }
    })();
  }, [router]);
  return null;
}
