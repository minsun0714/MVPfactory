import { redirect } from "next/navigation";
import { OfficeWorkspace } from "@/components/office/OfficeWorkspace";
import "@/styles/factory.css";
export default async function OfficePage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string }>;
}) {
  const query = await searchParams;
  if (query.panel === "projects") redirect("/projects");
  return <OfficeWorkspace />;
}
