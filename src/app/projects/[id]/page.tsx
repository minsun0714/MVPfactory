"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectDetailView } from "@/components/projects/ProjectDetailView";
import { useProject } from "@/hooks/useProject";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { project, error, run, pendingDecisions, refresh } = useProject(id);
  if (!project) {
    return (
      <>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p>프로젝트를 불러오는 중입니다…</p>
        )}
        <Link href="/">목록으로</Link>
      </>
    );
  }
  return (
    <ProjectDetailView
      project={project}
      run={run}
      error={error}
      pendingDecisions={pendingDecisions}
      onAnswered={refresh}
    />
  );
}
