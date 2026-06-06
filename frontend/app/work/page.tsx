import { Suspense } from "react";
import { WorkspaceShell } from "@/components/WorkspaceShell";

export default function WorkspacePage() {
  return (
    <Suspense fallback={null}>
      <WorkspaceShell />
    </Suspense>
  );
}
