import { WrapUpView } from "@/components/WrapUpView";

export default async function WrapUpPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WrapUpView ticketId={id} />;
}
