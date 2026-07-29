import { ShareUnlock } from "@/components/share-unlock";

export const metadata = { title: "Shared audit" };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main className="share-page"><ShareUnlock token={token}/></main>;
}
