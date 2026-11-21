import { useEffect, useState } from "react";
import { getProjects, type ProjectSummary } from "@/services/projects";

export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getProjects()
      .then((data) => {
        if (active) setProjects(data);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "조회에 실패했습니다.");
      });
    return () => {
      active = false;
    };
  }, []);

  return { projects, error };
}
