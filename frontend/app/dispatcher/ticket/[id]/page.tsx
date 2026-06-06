"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { setRoleCookie } from "@/lib/role";

export default function DispatcherTicketRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  useEffect(() => {
    setRoleCookie("dispatcher");
    router.replace(`/work?ticket=${id}`);
  }, [router, id]);
  return null;
}
