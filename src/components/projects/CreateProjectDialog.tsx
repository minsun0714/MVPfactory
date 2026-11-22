"use client";
import { useProjectCreation } from "@/hooks/useProjectCreation";
import { CEO_LEVELS, INPUT_LIMITS } from "@/contracts/common";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Dialog";
import { CommandNotice } from "@/components/office/ProjectOperations";
export function CreateProjectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const ui = useProjectCreation();
  return (
    <Dialog
      open={open}
      title="새 프로젝트"
      onClose={onClose}
      closeDisabled={ui.command.pending}
      dirty={!!(ui.form.name || ui.form.idea)}
    >
      <form
        className="pixel-stack"
        onSubmit={(e) => {
          e.preventDefault();
          ui.create();
        }}
      >
        <fieldset disabled={ui.command.pending} className="pixel-stack">
          <Field
            label="프로젝트 이름"
            required
            maxLength={INPUT_LIMITS.projectName}
            value={ui.form.name}
            onChange={(e) => ui.setForm({ ...ui.form, name: e.target.value })}
          />
          <TextArea
            label="아이디어"
            required
            maxLength={INPUT_LIMITS.idea}
            value={ui.form.idea}
            onChange={(e) => ui.setForm({ ...ui.form, idea: e.target.value })}
          />
          <Select
            label="대표님 참여 방식"
            value={ui.form.ceoLevel}
            onValueChange={(value) => {
              const level = CEO_LEVELS.find((v) => v === value);
              if (level) ui.setForm({ ...ui.form, ceoLevel: level });
            }}
          >
            <option value="DELEGATE">위임형</option>
            <option value="KEY_DECISIONS">핵심 결정형</option>
            <option value="COLLABORATIVE">공동 설계형</option>
          </Select>
          <p className="pixel-muted">
            저장 후 상세 화면으로 이동합니다. 실행은 별도로 시작합니다.
          </p>
          <Button type="submit" pending={ui.command.pending}>
            프로젝트 만들기
          </Button>
        </fieldset>
        <CommandNotice command={ui.command} />
      </form>
    </Dialog>
  );
}
