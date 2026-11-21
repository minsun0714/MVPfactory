"use client";
import { useProjects } from "@/hooks/useProjects";
import { ProjectListView } from "@/components/projects/ProjectListView";

export default function Home() {
  const { projects, error } = useProjects();
  return <ProjectListView projects={projects} error={error} />;
}
