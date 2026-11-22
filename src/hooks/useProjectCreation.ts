"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CeoLevel } from "@/contracts";
import { officeApi } from "@/services/office-api";
import { useOfficeCommand } from "@/hooks/useOfficeCommand";
export function useProjectCreation() {
  const router = useRouter();
  const [form, setForm] = useState<{
    name: string;
    idea: string;
    ceoLevel: CeoLevel;
  }>({ name: "", idea: "", ceoLevel: "KEY_DECISIONS" });
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
  return { form, setForm, command, create };
}
