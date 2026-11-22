"use client";
import { CreateProjectDialog } from "@/components/projects/CreateProjectDialog";
import { useState } from "react";
import { PixiOfficeScene } from "@/components/office/PixiOfficeScene";
import Link from "next/link";
import type { RoleId } from "@/contracts";
import { team } from "@/components/office/office-model";
import { useOfficeWorkspace } from "@/hooks/useOfficeWorkspace";
import { useDecisionReview } from "@/hooks/useDecisionReview";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Badge, EmptyState } from "@/components/ui/Status";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { RunStatusBadge, runTones } from "@/components/office/RunStatusBadge";
import {
  DecisionReview,
  MeetingApiPanel,
  QueryNotice,
  RoleApiPanel,
} from "@/components/office/OfficeApiPanels";
import { SettingsEditorPanel } from "@/components/office/OfficeEditors";
const menu = [
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
  const [creating, setCreating] = useState(false);
  const ui = useOfficeWorkspace(creating);
  const review = useDecisionReview(ui.decisionId, ui.answered);
  const role = team.find((member) => member.id === ui.panel);
  const busy = review.pending || ui.pendingCommands > 0;
  return (
    <div className="factory-ui office-page">
      <a className="pixel-skip-link" href="#office-content">
        사무실 내용으로 건너뛰기
      </a>
      <section
        className="office-content"
        id="office-content"
        aria-label="나의 사무실"
      >
        <header className="office-topline">
          <Link className="office-brand" href="/" aria-label="MVP 팩토리 홈">
            <PixelIcon name="office" width="28" height="28" />
            <span>MVP 팩토리</span>
          </Link>
          <div className="office-project-switcher">
            {!ui.listLoading && !ui.listError && ui.projects.length === 0 ? (
              <Button
                className="office-create-first"
                onClick={() => setCreating(true)}
                disabled={busy}
              >
                <PixelIcon name="plus" width="20" height="20" />새 프로젝트
                만들기
              </Button>
            ) : (
              <>
                <Select
                  label="프로젝트 선택"
                  value={ui.selectedId ?? ""}
                  disabled={busy || ui.listLoading}
                  onValueChange={ui.selectProject}
                >
                  {!ui.selectedId && (
                    <option value="" disabled>
                      {ui.listLoading ? "불러오는 중…" : "프로젝트 선택"}
                    </option>
                  )}
                  {ui.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  className="office-project-manage"
                  aria-label="새 프로젝트"
                  title="새 프로젝트"
                  onClick={() => setCreating(true)}
                >
                  <PixelIcon name="plus" width="20" height="20" />
                </button>
              </>
            )}
          </div>
          <nav className="office-top-actions" aria-label="회사 도구">
            <span
              className="office-live-indicator"
              tabIndex={0}
              aria-label={
                ui.connected
                  ? "실시간 업데이트 연결됨"
                  : ui.connection === "connecting"
                    ? "실시간 업데이트 연결 중"
                    : "실시간 업데이트 재연결 중"
              }
              data-state={ui.connection}
            >
              <span className="office-live-dot" aria-hidden="true" />
              <span className="office-live-tooltip" aria-hidden="true">
                {ui.connected
                  ? "실시간 업데이트 연결됨"
                  : ui.connection === "connecting"
                    ? "실시간 업데이트 연결 중"
                    : "실시간 업데이트 재연결 중"}
              </span>
            </span>
            {menu.map((item) => (
              <button
                type="button"
                key={item.id}
                disabled={busy}
                onClick={() => ui.openPanel(item.id)}
                aria-haspopup="dialog"
                aria-label={
                  item.id === "bell" && ui.decisions.length
                    ? `알림 ${ui.decisions.length}개`
                    : item.label
                }
                title={item.label}
                className={ui.panel === item.id ? "is-active" : ""}
              >
                <PixelIcon name={item.id} width="24" height="24" />
                {item.id === "bell" && ui.decisions.length > 0 && (
                  <span
                    className="office-notification-dot"
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
          </nav>
        </header>
        {ui.connection === "reconnecting" && (
          <p className="office-reconnection-notice" role="status">
            실시간 업데이트 재연결 중 · 15초마다 새로고침을 시도해요.
          </p>
        )}
        {ui.selectedId && (
          <section className="office-intro" aria-label="현재 실행 상태">
            {ui.state?.run ? (
              <div
                className="run-status"
                data-tone={runTones[ui.state.run.status]}
              >
                <RunStatusBadge
                  status={ui.state.run.status}
                  label={runLabels[ui.state.run.status]}
                />
                {ui.state.run.stage && (
                  <span className="run-stage">
                    <span className="run-stage-label">현재 단계</span>
                    <strong>{ui.state.run.stage.label}</strong>
                  </span>
                )}
                {ui.state.run.mode === "DEMO" && <Badge>과거 데모 기록</Badge>}
              </div>
            ) : (
              <p className="pixel-muted">아직 시작한 실행이 없어요.</p>
            )}
            <div className="pixel-wrap">
              <Link
                className="pixel-button office-run-link"
                href={`/projects/${encodeURIComponent(ui.selectedId)}`}
              >
                실행·결과 보기
                <PixelIcon name="arrow" width="18" height="18" />
              </Link>
            </div>
          </section>
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
            <Link href="/office">사무실로 돌아가기</Link>
          </div>
        )}
        <PixiOfficeScene
          state={ui.state}
          onRevisionSubmitted={ui.refresh}
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
      <CreateProjectDialog open={creating} onClose={() => setCreating(false)} />
      <Dialog
        open={ui.panel !== null}
        title={ui.panel ? titles[ui.panel] : ""}
        description={role?.title}
        closeDisabled={busy}
        dirty={ui.panel === "settings" && settingsDirty}
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
