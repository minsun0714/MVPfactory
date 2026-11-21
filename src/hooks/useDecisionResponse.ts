import { FormEvent, useState } from "react";
import { answerDecision } from "@/services/decisions";

export function useDecisionResponse(id: string, onAnswered: () => void) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await answerDecision(id, form.get("response"));
      onAnswered();
    } catch (e) {
      setError(e instanceof Error ? e.message : "응답에 실패했습니다.");
      setBusy(false);
    }
  }

  return { error, busy, submit };
}
