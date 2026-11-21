import { useEffect, useState } from "react";

type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  runs: { status: string }[];
};

export function useProjects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/projects")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setProjects(data);
      })
      .catch((e) => setError(e.message));
  }, []);

  return { projects, error };
}
