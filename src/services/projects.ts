import { readJson } from "./api";

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  runs: { status: string }[];
};

export type Artifact = {
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

export type Run = {
  id: string;
  status: string;
  stage: string;
  error: string | null;
  artifacts: Artifact[];
  decisions: Decision[];
};

export type Project = {
  name: string;
  idea: string;
  requirements: string;
  ceoLevel: string;
  runs: Run[];
};

export async function getProjects(): Promise<ProjectSummary[]> {
  return readJson(await fetch("/api/projects"));
}

export async function getProject(id: string): Promise<Project> {
  return readJson(await fetch(`/api/projects/${id}`, { cache: "no-store" }));
}

export async function createProject(
  fields: Record<string, FormDataEntryValue>,
): Promise<{ id: string }> {
  return readJson(
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    }),
  );
}
