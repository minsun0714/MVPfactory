"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CeoLevel, ProjectSummary } from "@/contracts";
import { apiPaths } from "@/contracts/paths";
import { officeApi } from "@/services/office-api";
import { officeCommands } from "@/services/office-commands";
import { useOfficeList } from "@/hooks/useOfficeList";
import { useOfficeCommand } from "@/hooks/useOfficeCommand";
export function useProjectManager() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    idea: string;
    ceoLevel: CeoLevel;
  }>({ name: "", idea: "", ceoLevel: "KEY_DECISIONS" });
  const list = useOfficeList<ProjectSummary>(
    `${apiPaths.projects}?archived=${filter === "archived"}`,
  );
  const command = useOfficeCommand();
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  function create() {
    const body = { ...form, name: form.name.trim(), idea: form.idea.trim() };
    if (!body.name || !body.idea) return;
    const fingerprint = JSON.stringify(body);
    if (submission.current?.fingerprint !== fingerprint)
      submission.current = { fingerprint, key: crypto.randomUUID() };
    const key = submission.current.key;
    void command.execute(
      () => officeApi.create(body, key),
      (project) => {
        submission.current = null;
        router.push(`/projects/${encodeURIComponent(project.id)}`);
      },
    );
  }
  const matching = (list.data?.items ?? []).filter((p) =>
    p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const totalPages = Math.max(1, Math.ceil(matching.length / 12));
  const currentPage = Math.min(page, totalPages);
  return {
    list,
    showCreatePrompt:
      filter === "active" &&
      !list.loading &&
      !list.error &&
      list.data?.items.length === 0,
    filter,
    setFilter: (value: string) => {
      setFilter(value);
      setPage(1);
    },
    search,
    setSearch: (value: string) => {
      setSearch(value);
      setPage(1);
    },
    creating,
    form,
    setForm,
    command,
    create,
    projects: matching.slice((currentPage - 1) * 12, currentPage * 12),
    total: matching.length,
    page: currentPage,
    totalPages,
    previous: () => setPage(currentPage - 1),
    next: () => setPage(currentPage + 1),
    openCreate: () => setCreating(true),
    closeCreate: () => {
      if (!command.pending) setCreating(false);
    },
    archive: (project: ProjectSummary) =>
      void command.execute(
        () => officeCommands.archive(project.id, !project.archived),
        list.reload,
      ),
  };
}
