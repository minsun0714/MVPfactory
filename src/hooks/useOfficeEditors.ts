"use client";
import { useEffect, useState } from "react";
import type {
  Company,
  Settings,
  RoleId,
  Provider,
  CharacterAppearance,
  OfficeLayout,
} from "@/contracts";
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
export function useCompanyEditor(
  initial: Company,
  reload: () => void,
  onDirtyChange?: (dirty: boolean) => void,
) {
  const [draft, setDraft] = useState(initial);
  const [role, setRole] = useState<RoleId>("PM");
  const [baseline, setBaseline] = useState(initial);
  const dirty =
    JSON.stringify([draft.characters, draft.office]) !==
    JSON.stringify([baseline.characters, baseline.office]);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const command = useOfficeCommand();
  function appearance(value: Partial<CharacterAppearance>) {
    setDraft((d) => ({
      ...d,
      characters: {
        ...d.characters,
        [role]: { ...d.characters[role], ...value },
      },
    }));
  }
  function layout(value: Partial<OfficeLayout>) {
    setDraft((d) => ({ ...d, office: { ...d.office, ...value } }));
  }
  function saved(company: Company) {
    setBaseline(company);
    // Keep unrelated unsaved edits; only advance the shared optimistic version.
    setDraft((d) => ({ ...d, version: company.version }));
    window.dispatchEvent(new Event("office-company-changed"));
  }
  return {
    draft,
    role,
    setRole,
    appearance,
    layout,
    command,
    reload,
    saveCharacter: () =>
      void command.execute(
        () =>
          officeCommands.character(role, {
            version: draft.version,
            appearance: draft.characters[role],
          }),
        saved,
      ),
    saveOffice: () =>
      void command.execute(
        () =>
          officeCommands.office({
            version: draft.version,
            layout: draft.office,
          }),
        saved,
      ),
  };
}
