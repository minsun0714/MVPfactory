"use client";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function NewProject() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error);
      router.push(`/projects/${data.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "요청에 실패했습니다."); setBusy(false); }
  }
  return <><h1>새 프로젝트 시작</h1><form className="card" onSubmit={submit}>
    <label htmlFor="name">프로젝트 이름</label><input id="name" name="name" maxLength={100} required />
    <label htmlFor="idea">아이디어</label><textarea id="idea" name="idea" maxLength={4000} required />
    <label htmlFor="ceoLevel">CEO 개입 수준</label><select id="ceoLevel" name="ceoLevel" defaultValue="KEY_DECISIONS">
      <option value="DELEGATE">위임형 — 중간 검토 없이 진행</option><option value="KEY_DECISIONS">핵심 결정형 — 개발 전 통합안 검토</option><option value="COLLABORATIVE">공동 설계형 — 기능 범위와 화면을 각각 검토</option>
    </select>
    {error && <p className="error" role="alert">{error}</p>}<button disabled={busy}>{busy ? "등록 중…" : "데모 실행 시작"}</button>
  </form></>;
}
