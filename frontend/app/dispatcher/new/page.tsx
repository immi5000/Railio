import { Suspense } from "react";
import { DispatcherIntake } from "@/components/DispatcherIntake";

export default function NewTicketPage() {
  return (
    <Suspense fallback={null}>
      <DispatcherIntake />
    </Suspense>
  );
}
