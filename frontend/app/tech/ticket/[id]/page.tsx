import { TechTicketView } from "@/components/TechTicketView";

export default async function TechTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TechTicketView ticketId={Number(id)} />;
}
