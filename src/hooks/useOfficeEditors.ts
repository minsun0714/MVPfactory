"use client";
import { useEffect, useState } from "react";
import type { Settings, Provider } from "@/contracts";
import { officeCommands } from "@/services/office-commands";
import { useOfficeCommand } from "@/hooks/useOfficeCommand";
export function useSettingsEditor(
  initial: Settings,
  onDirtyChange?: (dirty: boolean) => void,
  onSaved?: () => void,
) {
  const [draft, setDraft] = useState(initial);
  const command = useOfficeCommand();
  const [saved, setSaved] = useState(initial);
  const dirty =
    JSON.stringify([draft.repoVisibility, draft.limits]) !==
    JSON.stringify([saved.repoVisibility, saved.limits]);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  return {
    draft,
    setDraft,
    command,
    save: () =>
      void command.execute(
        () =>
          officeCommands.settings({
            repoVisibility: draft.repoVisibility,
            limits: draft.limits,
          }),
        (settings) => {
          setDraft(settings);
          setSaved(settings);
          onDirtyChange?.(false);
          onSaved?.();
        },
      ),
    verify: (provider: Provider) =>
      void command.execute(
        () => officeCommands.verify(provider),
        (connection) => {
          setDraft((d) => ({
            ...d,
            connections: d.connections.map((c) =>
              c.provider === provider ? connection : c,
            ),
          }));
        },
      ),
  };
}
