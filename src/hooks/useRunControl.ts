"use client";
import { useOfficeCommand } from "@/hooks/useOfficeCommand";
import { officeCommands } from "@/services/office-commands";
export function useRunControl(id: string, reload: () => void) {
  const command = useOfficeCommand();
  return {
    ...command,
    control: (action: "pause" | "resume" | "retry") =>
      void command.execute(() => officeCommands.control(id, action), reload),
  };
}
