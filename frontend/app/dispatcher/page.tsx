"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { setRoleCookie } from "@/lib/role";

export default function DispatcherQueueRedirect() {
  const router = useRouter();
  useEffect(() => {
    setRoleCookie("dispatcher");
    router.replace("/work");
  }, [router]);
  return null;
}
