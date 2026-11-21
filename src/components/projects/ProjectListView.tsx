import Link from "next/link";
import type { ProjectSummary } from "@/services/projects";

const statusLabels: Record<string, string> = {
  QUEUED: "대기",
  RUNNING: "진행 중",
  WAITING: "CEO 응답 대기",
  COMPLETED: "데모 완료",
  FAILED: "실패",
};

type ProjectListViewProps = {
  projects: ProjectSummary[] | null;
  error: string;
};

export function ProjectListView({ projects, error }: ProjectListViewProps) {
  return (
    <>
      <h1>프로젝트</h1>
      <p>아이디어를 가상 회사의 개발 계획으로 정리합니다.</p>
      <Link className="button" href="/new">
        새 프로젝트 시작
      </Link>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!projects && !error && <p>프로젝트를 불러오는 중입니다…</p>}
      {projects?.length === 0 && (
        <p className="card">
          아직 프로젝트가 없습니다. 새 프로젝트를 시작하세요.
        </p>
      )}
      {projects?.map((project) => (
        <div className="card" key={project.id}>
          <h2>
            <Link href={`/projects/${project.id}`}>{project.name}</Link>
          </h2>
          <p>최근 실행: {statusLabels[project.runs[0]?.status] ?? "없음"}</p>
          <p className="muted">
            생성 {new Date(project.createdAt).toLocaleString("ko-KR")} · 수정{" "}
            {new Date(project.updatedAt).toLocaleString("ko-KR")}
          </p>
        </div>
      ))}
    </>
  );
}
