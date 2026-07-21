import { Suspense } from "react";
import { CopilotShell } from "@/components/CopilotShell";

export default function CopilotPage() {
  return (
    <Suspense fallback={null}>
      <CopilotShell />
    </Suspense>
  );
}
