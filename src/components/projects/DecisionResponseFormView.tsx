import type { FormEventHandler } from "react";
import type { Decision } from "@/services/projects";

type DecisionResponseFormViewProps = {
  decision: Decision;
  error: string;
  busy: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

export function DecisionResponseFormView({
  decision,
  error,
  busy,
  onSubmit,
}: DecisionResponseFormViewProps) {
  return (
    <form className="card" onSubmit={onSubmit}>
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
