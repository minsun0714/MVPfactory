"use client";
import type { Settings } from "@/contracts";
import { apiPaths } from "@/contracts/paths";
import { useOfficeResource } from "@/hooks/useOfficeResource";
import { useSettingsEditor } from "@/hooks/useOfficeEditors";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { Card } from "@/components/ui/Status";
import { QueryNotice } from "@/components/office/OfficeApiPanels";
import { CommandNotice } from "@/components/office/ProjectOperations";
const connectionLabels = {
  CONNECTED: "연결됨 · 읽기 확인",
  NOT_CONNECTED: "연결 확인 전",
  INSUFFICIENT_PERMISSION: "권한 부족",
  DISCONNECTED: "연결 끊김",
};
export function SettingsEditorPanel({
  onDirtyChange,
  onSaved,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
}) {
  const query = useOfficeResource<Settings>(apiPaths.settings);
  return (
    <div className="pixel-stack">
      <QueryNotice {...query} retry={query.reload} />
      {query.data && (
        <SettingsEditor
          key={query.data.updatedAt}
          initial={query.data}
          onDirtyChange={onDirtyChange}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
function SettingsEditor({
  initial,
  onDirtyChange,
  onSaved,
}: {
  initial: Settings;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
}) {
  const ui = useSettingsEditor(initial, onDirtyChange, onSaved);
  return (
    <div className="pixel-stack">
      <h3>공통 기본 계정</h3>
      <p>비밀 키와 연결 대상은 .env에서 관리합니다.</p>
      <fieldset className="pixel-stack" disabled={ui.command.pending}>
        <div className="office-connection-grid">
          {ui.draft.connections.map((c) => (
            <Card key={c.provider}>
              <div className="office-connection-heading">
                <strong>{c.provider}</strong>
                <span
                  role="img"
                  className={`connection-dot connection-dot--${c.status === "CONNECTED" ? "ok" : c.status === "INSUFFICIENT_PERMISSION" ? "warning" : c.status === "DISCONNECTED" ? "down" : "unknown"}`}
                  aria-label={connectionLabels[c.status]}
                  title={connectionLabels[c.status]}
                />
              </div>
              <p>
                {c.target ?? "대상 없음"} · {c.message}
              </p>
              <Button variant="secondary" onClick={() => ui.verify(c.provider)}>
                연결 확인
              </Button>
            </Card>
          ))}
        </div>
        <Select
          label="새 저장소 공개 범위"
          value={ui.draft.repoVisibility}
          onValueChange={(value) =>
            ui.setDraft({
              ...ui.draft,
              repoVisibility: value === "PUBLIC" ? "PUBLIC" : "PRIVATE",
            })
          }
        >
          <option value="PRIVATE">비공개 저장소</option>
          <option value="PUBLIC">공개 저장소</option>
        </Select>
        {(
          [
            ["maxModelCalls", "모델 호출 횟수", "회"],
            ["maxFixAttempts", "자동 수정 횟수", "회"],
            ["maxActiveSeconds", "실행 시간", "초"],
            ["maxEstimatedCost", "예상 비용 한도", "USD"],
          ] as const
        ).map(([key, label, unit]) => (
          <Field
            key={key}
            label={label}
            suffix={unit}
            type="number"
            min={0}
            step={key === "maxEstimatedCost" ? "any" : 1}
            value={ui.draft.limits[key] ?? ""}
            onChange={(e) =>
              ui.setDraft({
                ...ui.draft,
                limits: {
                  ...ui.draft.limits,
                  [key]: e.target.value === "" ? null : Number(e.target.value),
                },
              })
            }
          />
        ))}
        <p>
          빈칸으로 저장하면 환경변수 또는 기본 한도를 사용합니다. 0은 실행을
          허용하지 않으며, 변경은 새 실행부터 적용됩니다.
        </p>
        <Button onClick={ui.save}>기본 설정 저장</Button>
      </fieldset>
      <CommandNotice command={ui.command} />
    </div>
  );
}
