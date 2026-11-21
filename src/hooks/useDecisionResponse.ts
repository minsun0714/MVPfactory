import { FormEvent, useState } from "react";

export function useDecisionResponse(id: string, onAnswered: () => void) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await fetch(`/api/decisions/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: form.get("response") }),
      });
      const data = await result.json();
      if (!result.ok) throw new Error(data.error);
      onAnswered();
    } catch (e) {
      setError(e instanceof Error ? e.message : "응답에 실패했습니다.");
      setBusy(false);
    }
  }

  return { error, busy, submit };
}
