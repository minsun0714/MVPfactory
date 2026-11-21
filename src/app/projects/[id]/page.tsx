"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type Artifact = { id: string; role: string; type: string; content: Record<string, string> };
type Decision = { id: string; type: string; proposal: string; status: string; response: string | null };
type Run = { id: string; status: string; stage: string; error: string | null; artifacts: Artifact[]; decisions: Decision[] };
type Project = { name: string; idea: string; requirements: string; ceoLevel: string; runs: Run[] };
const statusLabels: Record<string, string> = { QUEUED: "대기", RUNNING: "작업 중", WAITING: "CEO 응답 대기", COMPLETED: "데모 완료", FAILED: "실패" };
const roles = ["PM", "기획자", "디자이너", "개발자"];

function DecisionForm({ decision, onAnswered }: { decision: Decision; onAnswered: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await fetch(`/api/decisions/${decision.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ response: form.get("response") }) });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error);
      onAnswered();
    } catch (e) { setError(e instanceof Error ? e.message : "응답에 실패했습니다."); setBusy(false); }
  }
  return <form className="card" onSubmit={submit}><h3>CEO 검토 요청: {decision.type}</h3><pre>{decision.proposal}</pre>
    <label htmlFor={`response-${decision.id}`}>승인 또는 수정 의견</label><textarea id={`response-${decision.id}`} name="response" maxLength={4000} required placeholder="예: 승인합니다. 또는 변경할 내용을 입력하세요." />
    {error && <p className="error" role="alert">{error}</p>}<button disabled={busy}>{busy ? "응답 전송 중…" : "응답하고 계속하기"}</button>
  </form>;
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await fetch(`/api/projects/${id}`, { cache: "no-store" });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error);
        if (active) { setProject(data); setError(""); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "조회에 실패했습니다."); }
    }
    load();
    const timer = setInterval(load, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [id, refresh]);
  if (!project) return <>{error ? <p className="error" role="alert">{error}</p> : <p>프로젝트를 불러오는 중입니다…</p>}<Link href="/">목록으로</Link></>;
  const run = project.runs[0];
  return <><Link href="/">← 프로젝트 목록</Link><h1>{project.name}</h1><p>아이디어: {project.idea}</p><p>확정 요구사항: {project.requirements}</p>
    {error && <p className="error" role="alert">{error} 다시 조회 중입니다.</p>}
    {!run ? <p className="card">실행이 없습니다.</p> : <>
      <h2>가상 회사 진행 상황</h2><p>상태: <strong>{statusLabels[run.status]}</strong> · 현재 단계: {run.stage}</p>
      {run.status === "QUEUED" && <p className="muted">워커가 실행을 가져오기를 기다립니다.</p>}
      {run.error && <p className="error" role="alert">실패 원인: {run.error}</p>}
      <div className="grid">{roles.map((role, i) => {
        const done = run.artifacts.some((a) => a.role === role);
        const working = run.status === "RUNNING" && run.stage === role;
        return <div className="card" key={role}><h3>{["📋", "📝", "🎨", "💻"][i]} {role}</h3><p>{done ? "완료" : working ? "작업 중" : "대기"}</p></div>;
      })}</div>
      {run.status === "WAITING" && run.decisions.filter((d) => d.status === "PENDING").map((d) => <DecisionForm key={d.id} decision={d} onAnswered={() => setRefresh((v) => v + 1)} />)}
      <h2>결정 요약</h2>{run.decisions.length === 0 ? <p className="card">기록된 결정이 없습니다.</p> : run.decisions.map((d) => <div className="card" key={d.id}><h3>{d.type}</h3><p>{d.status === "PENDING" ? "응답 대기" : `응답: ${d.response}`}</p></div>)}
      <h2>역할별 산출물</h2>{run.artifacts.length === 0 ? <p className="card">아직 산출물이 없습니다.</p> : run.artifacts.map((a) => <div className="card" key={a.id}><h3>{a.role} · {a.type}</h3>{Object.entries(a.content).map(([key, value]) => <p key={key}><strong>{key.replaceAll("_", " ")}:</strong> {value}</p>)}</div>)}
      <h2>결과 및 연결 상태</h2><div className="card"><p>확인된 항목: 데모 역할별 계획 및 CEO 결정 기록</p><p>미구현: 실제 AI 생성, 생성 앱 코드, DB 자동 생성, GitHub push, Vercel 배포 및 수정 실행</p><ul><li>팩토리 운영 DB: 연결됨 (이 프로젝트 저장소)</li><li>생성 앱 DB (Supabase): 미연결</li><li>GitHub: 미연결</li><li>Vercel: 미연결</li><li>실제 LLM: 미연결</li></ul><button disabled title="실제 연동은 후속 작업입니다">배포 (미구현)</button></div>
    </>}
  </>;
}
