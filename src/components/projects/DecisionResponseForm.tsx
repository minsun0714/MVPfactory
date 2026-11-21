"use client";

import { useDecisionResponse } from "@/hooks/useDecisionResponse";
import type { Decision } from "@/services/projects";
import { DecisionResponseFormView } from "@/components/projects/DecisionResponseFormView";

type DecisionResponseFormProps = {
  decision: Decision;
  onAnswered: () => void;
};

export function DecisionResponseForm({
  decision,
  onAnswered,
}: DecisionResponseFormProps) {
  const { error, busy, submit } = useDecisionResponse(decision.id, onAnswered);

  return (
    <DecisionResponseFormView
      decision={decision}
      error={error}
      busy={busy}
      onSubmit={submit}
    />
  );
}
