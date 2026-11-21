import { readJson } from "./api";

export async function answerDecision(
  id: string,
  response: FormDataEntryValue | null,
): Promise<{ ok: boolean }> {
  return readJson(
    await fetch(`/api/decisions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    }),
  );
}
