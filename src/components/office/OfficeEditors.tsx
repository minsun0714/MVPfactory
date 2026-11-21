"use client";
import type { Company, CompanyCatalog, Settings } from "@/contracts";
import { ROLE_IDS } from "@/contracts/common";
import { apiPaths } from "@/contracts/paths";
import { useOfficeResource } from "@/hooks/useOfficeResource";
import { useCompanyEditor, useSettingsEditor } from "@/hooks/useOfficeEditors";
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
                연결 확인: {c.provider}
              </Button>
            </Card>
          ))}
        </div>
        <Select
          label="새 저장소 공개 범위"
          value={ui.draft.repoVisibility}
          onChange={(e) =>
            ui.setDraft({
              ...ui.draft,
              repoVisibility:
                e.target.value === "PUBLIC" ? "PUBLIC" : "PRIVATE",
            })
          }
        >
          <option value="PRIVATE">비공개 저장소</option>
          <option value="PUBLIC">공개 저장소</option>
        </Select>
        <p>생성 앱의 접속 범위는 로그인 없는 공개 앱입니다.</p>
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
export function CompanyEditorPanel({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const company = useOfficeResource<Company>(apiPaths.company);
  const catalog = useOfficeResource<CompanyCatalog>(apiPaths.companyCatalog);
  return (
    <div className="pixel-stack">
      <QueryNotice {...company} retry={company.reload} />
      <QueryNotice {...catalog} retry={catalog.reload} />
      {company.data && catalog.data && (
        <CompanyEditor
          key={company.data.version}
          initial={company.data}
          catalog={catalog.data}
          reload={company.reload}
          onDirtyChange={onDirtyChange}
        />
      )}
    </div>
  );
}
function CompanyEditor({
  initial,
  catalog,
  reload,
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  initial: Company;
  catalog: CompanyCatalog;
  reload: () => void;
}) {
  const ui = useCompanyEditor(initial, reload, onDirtyChange);
  const appearance = ui.draft.characters[ui.role];
  return (
    <>
      <p className="mobile-only">꾸미기 편집은 PC에서 사용할 수 있어요.</p>
      <div className="office-company-editor pixel-stack">
        <p>모든 프로젝트가 공유하는 회사 설정 · 버전 {ui.draft.version}</p>
        <fieldset disabled={ui.command.pending} className="pixel-stack">
          <h3>캐릭터 외형</h3>
          <Select
            label="팀원"
            value={ui.role}
            onChange={(e) => {
              const role = ROLE_IDS.find((r) => r === e.target.value);
              if (role) ui.setRole(role);
            }}
          >
            {ROLE_IDS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
          {(
            [
              ["body", "BODY", "체형"],
              ["hair", "HAIR", "머리"],
              ["outfit", "OUTFIT", "의상"],
            ] as const
          ).map(([key, category, label]) => (
            <Select
              key={key}
              label={label}
              value={appearance[key]}
              onChange={(e) => ui.appearance({ [key]: e.target.value })}
            >
              {catalog.items
                .filter((i) => i.category === category)
                .map((i) => (
                  <option value={i.id} key={i.id}>
                    {i.name}
                  </option>
                ))}
            </Select>
          ))}
          <fieldset>
            <legend>액세서리 (최대 5개)</legend>
            {catalog.items
              .filter((i) => i.category === "ACCESSORY")
              .map((i) => (
                <label className="pixel-check" key={i.id}>
                  <input
                    type="checkbox"
                    checked={appearance.accessories.includes(i.id)}
                    onChange={(e) =>
                      ui.appearance({
                        accessories: e.target.checked
                          ? [...appearance.accessories, i.id]
                          : appearance.accessories.filter((id) => id !== i.id),
                      })
                    }
                  />
                  {i.name}
                </label>
              ))}
          </fieldset>
          <Button onClick={ui.saveCharacter}>이 팀원 외형 저장</Button>
          <h3>사무실 배치</h3>
          <Select
            label="사무실 확장"
            value={ui.draft.office.expansionLevel}
            onChange={(e) =>
              ui.layout({ expansionLevel: Number(e.target.value) })
            }
          >
            {catalog.expansions.map((e) => (
              <option key={e.level} value={e.level}>
                {e.name}
              </option>
            ))}
          </Select>
          <div className="office-layout-map" aria-label="사무실 배치 미리보기">
            {ui.draft.office.items.map((item, index) => (
              <span
                key={index}
                style={{
                  left: `${item.x}%`,
                  top: `${item.y}%`,
                  transform: `rotate(${item.rotation}deg)`,
                }}
                title={catalog.items.find((i) => i.id === item.itemId)?.name}
              >
                {index + 1}
              </span>
            ))}
          </div>
          {ui.draft.office.items.map((item, index) => (
            <Card key={index}>
              <strong>
                {index + 1}.{" "}
                {catalog.items.find((i) => i.id === item.itemId)?.name}
              </strong>
              <div className="pixel-wrap">
                {(["x", "y"] as const).map((axis) => (
                  <Field
                    key={axis}
                    label={`${index + 1}번 ${axis} 좌표`}
                    type="number"
                    min={0}
                    max={99}
                    step={1}
                    value={item[axis]}
                    onChange={(e) =>
                      ui.layout({
                        items: ui.draft.office.items.map((p, n) =>
                          n === index
                            ? { ...p, [axis]: Number(e.target.value) }
                            : p,
                        ),
                      })
                    }
                  />
                ))}
                <Select
                  label={`${index + 1}번 방향`}
                  value={item.rotation}
                  onChange={(e) =>
                    ui.layout({
                      items: ui.draft.office.items.map((p, n) =>
                        n === index
                          ? { ...p, rotation: Number(e.target.value) }
                          : p,
                      ),
                    })
                  }
                >
                  {[0, 90, 180, 270].map((r) => (
                    <option key={r} value={r}>
                      {r}°
                    </option>
                  ))}
                </Select>
                <Button
                  variant="secondary"
                  onClick={() =>
                    ui.layout({
                      items: ui.draft.office.items.filter(
                        (_, n) => n !== index,
                      ),
                    })
                  }
                >
                  배치 제거
                </Button>
              </div>
            </Card>
          ))}
          <Select
            label="가구 추가"
            value=""
            disabled={ui.draft.office.items.length >= 200}
            onChange={(e) => {
              if (e.target.value)
                ui.layout({
                  items: [
                    ...ui.draft.office.items,
                    { itemId: e.target.value, x: 50, y: 50, rotation: 0 },
                  ],
                });
            }}
          >
            <option value="">아이템 선택</option>
            {catalog.items
              .filter((i) =>
                ["FURNITURE", "DECOR", "MEETING"].includes(i.category),
              )
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
          </Select>
          <Button onClick={ui.saveOffice}>사무실 배치 저장</Button>
        </fieldset>
        <CommandNotice command={ui.command} />
        {ui.command.error && (
          <Button variant="secondary" onClick={reload}>
            편집 내용을 버리고 최신 설정 불러오기
          </Button>
        )}
        <p className="pixel-muted">
          배치 미리보기는 저장할 좌표를 보여줍니다. 메인 사무실의 픽셀아트는
          아직 고정 시안입니다.
        </p>
      </div>
    </>
  );
}
