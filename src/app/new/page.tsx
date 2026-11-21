"use client";
import { useNewProject } from "@/hooks/useNewProject";
import { NewProjectFormView } from "@/components/projects/NewProjectFormView";

export default function NewProject() {
  const { error, busy, submit } = useNewProject();
  return <NewProjectFormView error={error} busy={busy} onSubmit={submit} />;
}
