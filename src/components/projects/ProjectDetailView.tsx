import Link from "next/link";
import { useDecisionResponse } from "@/hooks/useDecisionResponse";
import type { Decision, Project, Run } from "@/services/projects";

const statusLabels: Record<string, string> = {
  QUEUED: "대기",
  RUNNING: "작업 중",
  WAITING: "CEO 응답 대기",
  COMPLETED: "데모 완료",
  FAILED: "실패",
};
const roles = ["PM", "기획자", "디자이너", "개발자"];
const roleIcons = ["📋", "📝", "🎨", "💻"];

type ProjectDetailViewProps = {
  project: Project;
  run: Run | undefined;
  error: string;
  pendingDecisions: Decision[];
  onAnswered: () => void;
};

function DecisionResponseForm({
  decision,
  onAnswered,
}: {
  decision: Decision;
  onAnswered: () => void;
}) {
  const { error, busy, submit } = useDecisionResponse(decision.id, onAnswered);

  return (
    <form className="card" onSubmit={submit}>
      <h3>CEO 검토 요청: {decision.type}</h3>
      <pre>{decision.proposal}</pre>
      <label htmlFor={`response-${decision.id}`}>승인 또는 수정 의견</label>
      <textarea
        id={`response-${decision.id}`}
        name="response"
        maxLength={4000}
        required
        placeholder="예: 승인합니다. 또는 변경할 내용을 입력하세요."
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy}>
        {busy ? "응답 전송 중…" : "응답하고 계속하기"}
      </button>
    </form>
  );
}

function ProjectProgress({ run }: { run: Run }) {
  return (
    <>
      <h2>가상 회사 진행 상황</h2>
      <p>
        상태: <strong>{statusLabels[run.status]}</strong> · 현재 단계:{" "}
        {run.stage}
      </p>
      {run.status === "QUEUED" && (
        <p className="muted">워커가 실행을 가져오기를 기다립니다.</p>
      )}
      {run.error && (
        <p className="error" role="alert">
          실패 원인: {run.error}
        </p>
      )}
      <div className="grid">
        {roles.map((role, index) => {
          const done = run.artifacts.some((artifact) => artifact.role === role);
          const working = run.status === "RUNNING" && run.stage === role;
          return (
            <div className="card" key={role}>
              <h3>
                {roleIcons[index]} {role}
              </h3>
              <p>{done ? "완료" : working ? "작업 중" : "대기"}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}

function DecisionSummary({ decisions }: { decisions: Decision[] }) {
  return (
    <>
      <h2>결정 요약</h2>
      {decisions.length === 0 ? (
        <p className="card">기록된 결정이 없습니다.</p>
      ) : (
        decisions.map((decision) => (
          <div className="card" key={decision.id}>
            <h3>{decision.type}</h3>
            <p>
              {decision.status === "PENDING"
                ? "응답 대기"
                : `응답: ${decision.response}`}
            </p>
          </div>
        ))
      )}
    </>
  );
}

function ArtifactList({ artifacts }: { artifacts: Run["artifacts"] }) {
  return (
    <>
      <h2>역할별 산출물</h2>
      {artifacts.length === 0 ? (
        <p className="card">아직 산출물이 없습니다.</p>
      ) : (
        artifacts.map((artifact) => (
          <div className="card" key={artifact.id}>
            <h3>
              {artifact.role} · {artifact.type}
            </h3>
            {Object.entries(artifact.content).map(([key, value]) => (
              <p key={key}>
                <strong>{key.replaceAll("_", " ")}:</strong> {value}
              </p>
            ))}
          </div>
        ))
      )}
    </>
  );
}

function IntegrationStatus({ hasError }: { hasError: boolean }) {
  return (
    <>
      <h2>결과 및 연결 상태</h2>
      <div className="card">
        <p>확인된 항목: 데모 역할별 계획 및 CEO 결정 기록</p>
        <p>
          미구현: 실제 AI 생성, 생성 앱 코드, DB 자동 생성, GitHub push, Vercel
          배포 및 수정 실행
        </p>
        <ul>
          <li>
            팩토리 운영 DB:{" "}
            {hasError ? "연결 상태 확인 불가" : "연결됨 (이 프로젝트 저장소)"}
          </li>
          <li>생성 앱 DB (Supabase): 미연결</li>
          <li>GitHub: 미연결</li>
          <li>Vercel: 미연결</li>
          <li>실제 LLM: 미연결</li>
        </ul>
        <button disabled title="실제 연동은 후속 작업입니다">
          배포 (미구현)
        </button>
      </div>
    </>
  );
}

export function ProjectDetailView({
  project,
  run,
  error,
  pendingDecisions,
  onAnswered,
}: ProjectDetailViewProps) {
  return (
    <>
      <Link href="/">← 프로젝트 목록</Link>
      <h1>{project.name}</h1>
      <p>아이디어: {project.idea}</p>
      <p>확정 요구사항: {project.requirements}</p>
      {error && (
        <p className="error" role="alert">
          {error} 다시 조회 중입니다.
        </p>
      )}
      {!run ? (
        <p className="card">실행이 없습니다.</p>
      ) : (
        <>
          <ProjectProgress run={run} />
          {pendingDecisions.map((decision) => (
            <DecisionResponseForm
              key={decision.id}
              decision={decision}
              onAnswered={onAnswered}
            />
          ))}
          <DecisionSummary decisions={run.decisions} />
          <ArtifactList artifacts={run.artifacts} />
          <IntegrationStatus hasError={Boolean(error)} />
        </>
      )}
    </>
  );
}
