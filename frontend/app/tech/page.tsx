"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { setRoleCookie } from "@/lib/role";

export default function TechQueueRedirect() {
  const router = useRouter();
  useEffect(() => {
    setRoleCookie("tech");
    router.replace("/work");
  }, [router]);
  return null;
}
