"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useDecisionResponse } from "@/hooks/useDecisionResponse";
import { useProject, type Decision } from "@/hooks/useProject";

const statusLabels: Record<string, string> = {
  QUEUED: "대기",
  RUNNING: "작업 중",
  WAITING: "CEO 응답 대기",
  COMPLETED: "데모 완료",
  FAILED: "실패",
};
const roles = ["PM", "기획자", "디자이너", "개발자"];

function DecisionForm({
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

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { project, error, run, pendingDecisions, refresh } = useProject(id);
  if (!project)
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
            {roles.map((role, i) => {
              const done = run.artifacts.some((a) => a.role === role);
              const working = run.status === "RUNNING" && run.stage === role;
              return (
                <div className="card" key={role}>
                  <h3>
                    {["📋", "📝", "🎨", "💻"][i]} {role}
                  </h3>
                  <p>{done ? "완료" : working ? "작업 중" : "대기"}</p>
                </div>
              );
            })}
          </div>
          {pendingDecisions.map((d) => (
            <DecisionForm key={d.id} decision={d} onAnswered={refresh} />
          ))}
          <h2>결정 요약</h2>
          {run.decisions.length === 0 ? (
            <p className="card">기록된 결정이 없습니다.</p>
          ) : (
            run.decisions.map((d) => (
              <div className="card" key={d.id}>
                <h3>{d.type}</h3>
                <p>
                  {d.status === "PENDING" ? "응답 대기" : `응답: ${d.response}`}
                </p>
              </div>
            ))
          )}
          <h2>역할별 산출물</h2>
          {run.artifacts.length === 0 ? (
            <p className="card">아직 산출물이 없습니다.</p>
          ) : (
            run.artifacts.map((a) => (
              <div className="card" key={a.id}>
                <h3>
                  {a.role} · {a.type}
                </h3>
                {Object.entries(a.content).map(([key, value]) => (
                  <p key={key}>
                    <strong>{key.replaceAll("_", " ")}:</strong> {value}
                  </p>
                ))}
              </div>
            ))
          )}
          <h2>결과 및 연결 상태</h2>
          <div className="card">
            <p>확인된 항목: 데모 역할별 계획 및 CEO 결정 기록</p>
            <p>
              미구현: 실제 AI 생성, 생성 앱 코드, DB 자동 생성, GitHub push,
              Vercel 배포 및 수정 실행
            </p>
            <ul>
              <li>
                팩토리 운영 DB:{" "}
                {error ? "연결 상태 확인 불가" : "연결됨 (이 프로젝트 저장소)"}
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
      )}
    </>
  );
}
