import { ProjectExecutionPage } from "@/components/projects/ProjectExecutionPage";
import "@/styles/factory.css";
export default async function HistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectExecutionPage id={id} history />;
}
