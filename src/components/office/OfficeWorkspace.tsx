"use client";
import { useState } from "react";
import { PixiOfficeScene } from "@/components/office/PixiOfficeScene";
import Link from "next/link";
import type { RoleId } from "@/contracts";
import { team } from "@/hooks/useOfficePreview";
import { useOfficeWorkspace } from "@/hooks/useOfficeWorkspace";
import { useDecisionReview } from "@/hooks/useDecisionReview";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Badge, EmptyState } from "@/components/ui/Status";
import { PixelIcon } from "@/components/ui/PixelIcon";
import {
  DecisionReview,
  MeetingApiPanel,
  QueryNotice,
  RoleApiPanel,
} from "@/components/office/OfficeApiPanels";
import {
  CompanyEditorPanel,
  SettingsEditorPanel,
} from "@/components/office/OfficeEditors";
const menu = [
  { id: "palette", label: "꾸미기" },
  { id: "settings", label: "설정" },
  { id: "bell", label: "알림" },
] as const;
const roleIds: Record<string, RoleId> = {
  pm: "PM",
  planner: "PLANNER",
  designer: "DESIGNER",
  developer: "DEVELOPER",
};
const rolePanels = {
  PM: "pm",
  PLANNER: "planner",
  DESIGNER: "designer",
  DEVELOPER: "developer",
} as const;
const titles = {
  projects: "프로젝트",
  palette: "우리 회사 꾸미기",
  settings: "공통 설정",
  bell: "결정 알림",
  meeting: "회의 기록",
  pm: "PM",
  planner: "기획자",
  designer: "디자이너",
  developer: "개발자",
  decision: "대표님의 결정이 필요해요",
};
const runLabels = {
  QUEUED: "실행 대기",
  RUNNING: "실행 중",
  WAITING_CEO: "대표님 응답 대기",
  PAUSED: "일시정지",
  BLOCKED: "진행 차단",
  FAILED: "실패",
  SUCCEEDED: "실행 완료",
};
export function OfficeWorkspace() {
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [companyDirty, setCompanyDirty] = useState(false);
  const ui = useOfficeWorkspace();
  const review = useDecisionReview(ui.decisionId, ui.answered);
  const role = team.find((member) => member.id === ui.panel);
  const title =
    ui.selected?.name ?? (ui.listLoading ? "회사를 불러오는 중" : "나의 회사");
  const busy = review.pending || ui.pendingCommands > 0;
  return (
    <div className="factory-ui office-page">
      <a className="pixel-skip-link" href="#office-content">
        사무실 내용으로 건너뛰기
      </a>
      <aside className="office-rail" aria-label="회사 도구">
        <Link className="office-mark" href="/office" aria-label="나의 사무실">
          <PixelIcon name="office" width="28" height="28" />
        </Link>
        <nav aria-label="주 메뉴">
          <Link
            href="/projects"
            className="office-project-nav"
            aria-label="프로젝트"
          >
            <PixelIcon name="projects" width="24" height="24" />
            <span>프로젝트</span>
          </Link>
          {menu.map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={busy}
              onClick={() => ui.openPanel(item.id)}
              aria-haspopup="dialog"
              aria-label={item.label}
              className={ui.panel === item.id ? "is-active" : ""}
            >
              <PixelIcon name={item.id} width="24" height="24" />
              <span>
                {item.label}
                {item.id === "bell" && ui.decisions.length > 0
                  ? ` ${ui.decisions.length}`
                  : ""}
              </span>
            </button>
          ))}
        </nav>
        <Link className="office-system-link" href="/design-system">
          <PixelIcon name="grid" />
          <span>UI 도감</span>
        </Link>
      </aside>
      <section
        className="office-content"
        id="office-content"
        aria-label="나의 사무실"
      >
        <div className="office-topline">
          <div>
            <span className="pixel-eyebrow">MY LITTLE COMPANY</span>
            <h1>{title}</h1>
          </div>
          <div className="pixel-wrap">
            <Badge tone={ui.connected ? "success" : "warning"}>
              {ui.connected ? "실시간 연결" : "연결 확인 중 · 주기적 조회"}
            </Badge>
            {ui.state?.run?.mode === "DEMO" && <Badge>과거 데모 기록</Badge>}
          </div>
        </div>
        {ui.selectedId && (
          <div className="office-intro">
            {ui.state?.run && (
              <>
                <span className="office-dot" aria-hidden="true" />
                <p>
                  {runLabels[ui.state.run.status]}
                  {ui.state.run.stage ? ` · ${ui.state.run.stage.label}` : ""}
                </p>
              </>
            )}
            <Link href={`/projects/${encodeURIComponent(ui.selectedId)}`}>
              실행·결과
            </Link>
          </div>
        )}
        <QueryNotice
          loading={ui.listLoading}
          error={ui.listError}
          retry={ui.refresh}
        />
        <QueryNotice
          loading={!!ui.selectedId && !ui.state && !ui.stateError}
          error={ui.stateError}
          retry={ui.refresh}
        />
        {ui.stateError && ui.state && (
          <p className="pixel-muted">
            마지막 확인 상태입니다. 최신 정보 조회에 실패했습니다.
          </p>
        )}
        {ui.missingProject && (
          <div role="alert" className="pixel-stack">
            <p>요청한 프로젝트를 찾을 수 없어요.</p>
            <Link href="/projects">프로젝트 목록으로</Link>
          </div>
        )}
        {!ui.missingProject &&
          !ui.listLoading &&
          !ui.listError &&
          ui.projects.length === 0 && (
            <div className="office-empty-start">
              <p>
                아직 프로젝트가 없어요. 아이디어를 등록하면 이 공간에서 함께
                관리해요.
              </p>
              <Link href="/projects">프로젝트 만들기</Link>
            </div>
          )}
        <PixiOfficeScene
          state={ui.state}
          zoom={100}
          disabled={busy}
          onRole={(role) => ui.openPanel(rolePanels[role])}
          onMeeting={() => ui.openPanel("meeting")}
        />
        {ui.decisions
          .filter((d) => d.projectId === ui.selectedId)
          .map((d) => (
            <div className="office-decision-notice" key={d.id}>
              <span>
                {d.title} · 제안 {d.proposalVersion}
              </span>
              <Button onClick={() => ui.openDecision(d.id)}>검토하기</Button>
            </div>
          ))}
      </section>
      <Dialog
        open={ui.panel !== null}
        title={ui.panel ? titles[ui.panel] : ""}
        description={role?.title}
        closeDisabled={busy}
        dirty={
          (ui.panel === "settings" && settingsDirty) ||
          (ui.panel === "palette" && companyDirty)
        }
        onClose={() => {
          if (!busy) ui.closePanel();
        }}
      >
        {busy && (
          <p role="status">
            서버 응답을 기다리고 있습니다. 전송 중에는 창을 닫지 않습니다.
          </p>
        )}
        {role && (
          <RoleApiPanel
            key={`${ui.selectedId}:${role.id}`}
            state={ui.state}
            role={roleIds[role.id]}
          />
        )}
        {ui.panel === "decision" && <DecisionReview review={review} />}
        {ui.panel === "settings" && (
          <SettingsEditorPanel
            onDirtyChange={setSettingsDirty}
            onSaved={ui.closePanel}
          />
        )}
        {ui.panel === "palette" && (
          <CompanyEditorPanel onDirtyChange={setCompanyDirty} />
        )}
        {ui.panel === "meeting" && (
          <MeetingApiPanel
            id={ui.state?.activeMeeting?.id ?? null}
            revision={ui.state?.lastSequence}
          />
        )}
        {ui.panel === "bell" && (
          <div className="pixel-stack">
            <QueryNotice
              loading={ui.listLoading}
              error={ui.listError}
              retry={ui.refresh}
            />
            {ui.decisions.map((d) => (
              <div className="office-decision-notice" key={d.id}>
                <div>
                  <strong>{d.title}</strong>
                  <p className="pixel-muted">
                    {ui.projects.find((p) => p.id === d.projectId)?.name ??
                      d.projectId}{" "}
                    · 제안 {d.proposalVersion}
                  </p>
                </div>
                <Button onClick={() => ui.openDecision(d.id)}>검토</Button>
              </div>
            ))}
            {!ui.listLoading && !ui.listError && ui.decisions.length === 0 && (
              <EmptyState title="기다리는 결정이 없어요">
                결정이 도착하면 이곳에서 다시 확인할 수 있습니다.
              </EmptyState>
            )}
          </div>
        )}
      </Dialog>
      <div className="pixel-toast-region" role="status" aria-live="polite">
        {ui.toast && (
          <div className="pixel-toast">
            <PixelIcon name="check" />
            <span>{ui.toast}</span>
            <Button
              variant="ghost"
              aria-label="알림 닫기"
              onClick={ui.dismissToast}
            >
              <PixelIcon name="close" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
