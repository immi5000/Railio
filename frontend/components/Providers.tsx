"use client";

import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState } from "react";
import { PostHogProvider } from "@/components/PostHogProvider";
import { RoleProvider } from "@/components/RoleProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  return (
    <PostHogProvider>
      <QueryClientProvider client={client}>
        <RoleProvider>{children}</RoleProvider>
      </QueryClientProvider>
    </PostHogProvider>
  );
}
