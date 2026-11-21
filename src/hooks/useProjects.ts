import { useEffect, useState } from "react";
import { getProjects, type ProjectSummary } from "@/services/projects";

export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getProjects()
      .then((data) => {
        setProjects(data);
      })
      .catch((e) => setError(e.message));
  }, []);

  return { projects, error };
}
