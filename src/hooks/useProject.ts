import { useEffect, useState } from "react";

type Artifact = {
  id: string;
  role: string;
  type: string;
  content: Record<string, string>;
};
export type Decision = {
  id: string;
  type: string;
  proposal: string;
  status: string;
  response: string | null;
};
type Run = {
  id: string;
  status: string;
  stage: string;
  error: string | null;
  artifacts: Artifact[];
  decisions: Decision[];
};
type Project = {
  name: string;
  idea: string;
  requirements: string;
  ceoLevel: string;
  runs: Run[];
};

export function useProject(id: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await fetch(`/api/projects/${id}`, {
          cache: "no-store",
        });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error);
        if (active) {
          setProject(data);
          setError("");
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "조회에 실패했습니다.");
      }
    }
    load();
    const timer = setInterval(load, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, refresh]);

  const run = project?.runs[0];
  const pendingDecisions =
    run?.status === "WAITING"
      ? run.decisions.filter((d) => d.status === "PENDING")
      : [];

  return {
    project,
    error,
    run,
    pendingDecisions,
    refresh: () => setRefresh((v) => v + 1),
  };
}
