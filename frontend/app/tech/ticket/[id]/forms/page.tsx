import { Suspense } from "react";
import { FormsTab } from "@/components/FormsTab";

export default async function FormsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <FormsTab ticketId={Number(id)} />
    </Suspense>
  );
}
