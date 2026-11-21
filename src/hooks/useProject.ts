import { useEffect, useState } from "react";
import { getProject, type Project } from "@/services/projects";

export function useProject(id: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await getProject(id);
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
