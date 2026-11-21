import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { createProject } from "@/services/projects";

export function useNewProject() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const data = await createProject(Object.fromEntries(form));
      router.push(`/projects/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
      setBusy(false);
    }
  }

  return { error, busy, submit };
}
