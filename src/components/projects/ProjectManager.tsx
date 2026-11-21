"use client";
import Link from "next/link";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { useProjectManager } from "@/hooks/useProjectManager";
import { CEO_LEVELS, INPUT_LIMITS } from "@/contracts/common";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Dialog";
import { Badge, Card, EmptyState } from "@/components/ui/Status";
import { QueryNotice } from "@/components/office/OfficeApiPanels";
import { CommandNotice } from "@/components/office/ProjectOperations";
const statuses = {
  QUEUED: "실행 대기",
  RUNNING: "실행 중",
  WAITING_CEO: "승인 대기",
  PAUSED: "일시정지",
  BLOCKED: "진행 차단",
  FAILED: "실패",
  SUCCEEDED: "실행 완료",
};
export function ProjectManager() {
  const ui = useProjectManager();
  return (
    <div className="factory-ui project-manager">
      <nav aria-label="페이지 이동">
        <Link href="/office">← 사무실로</Link>
      </nav>
      {!ui.showCreatePrompt && (
        <>
          <div className="pixel-row">
            <div>
              <h1>프로젝트</h1>
              <p className="pixel-muted">
                프로젝트를 고르고, 새 아이디어를 시작하세요.
              </p>
            </div>
            <Button onClick={ui.openCreate} disabled={ui.command.pending}>
              새 프로젝트
            </Button>
          </div>
          <div className="project-filters">
            <Field
              label="프로젝트 이름 검색"
              placeholder="프로젝트 이름"
              value={ui.search}
              onChange={(e) => ui.setSearch(e.target.value)}
            />
            <Select
              label="목록 범위"
              value={ui.filter}
              disabled={ui.command.pending}
              onChange={(e) => ui.setFilter(e.target.value)}
            >
              <option value="active">사용 중</option>
              <option value="archived">보관됨</option>
            </Select>
          </div>
        </>
      )}
      <QueryNotice {...ui.list} retry={ui.list.reload} />
      {!ui.creating && <CommandNotice command={ui.command} />}
      {!ui.showCreatePrompt && ui.list.data && (
        <p className="pixel-muted">{ui.total}개 프로젝트</p>
      )}
      <div className="project-cards">
        {ui.projects.map((project) => (
          <Card key={project.id}>
            <div className="pixel-stack">
              <div className="pixel-row">
                <h2>
                  <Link href={`/projects/${encodeURIComponent(project.id)}`}>
                    {project.name}
                  </Link>
                </h2>
                <Badge>
                  {project.archived
                    ? "보관됨"
                    : project.latestRun
                      ? statuses[project.latestRun.status]
                      : "시작 전"}
                </Badge>
              </div>
              <p className="pixel-muted">
                {new Date(project.createdAt).toLocaleDateString("ko-KR")} 생성
                {project.latestRun
                  ? ` · ${project.latestRun.mode === "DEMO" ? "과거 데모 기록" : "앱 생성"}`
                  : ""}
              </p>
              <div className="pixel-wrap">
                <Link
                  href={`/office?project=${encodeURIComponent(project.id)}`}
                >
                  사무실 열기
                </Link>
                <Link href={`/projects/${encodeURIComponent(project.id)}`}>
                  실행·결과 보기
                </Link>
                <Button
                  variant="ghost"
                  disabled={ui.command.pending}
                  onClick={() => ui.archive(project)}
                >
                  {project.archived ? "복원" : "보관"}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {ui.totalPages > 1 && (
        <nav className="pixel-wrap" aria-label="목록 페이지">
          <Button
            variant="secondary"
            disabled={ui.page === 1}
            onClick={ui.previous}
          >
            이전
          </Button>
          <span>
            {ui.page} / {ui.totalPages}
          </span>
          <Button
            variant="secondary"
            disabled={ui.page === ui.totalPages}
            onClick={ui.next}
          >
            다음
          </Button>
        </nav>
      )}
      {ui.showCreatePrompt && (
        <section
          className="project-create-prompt"
          aria-labelledby="create-project-title"
        >
          <h1 id="create-project-title">어떤 앱을 만들어볼까요?</h1>
          <p>아이디어 하나로 첫 프로젝트를 시작하세요.</p>
          <Button
            className="project-create-hero-button"
            onClick={ui.openCreate}
            disabled={ui.command.pending}
          >
            <PixelIcon name="plus" width="32" height="32" aria-hidden="true" />
            새 프로젝트 만들기
          </Button>
          <Button variant="ghost" onClick={() => ui.setFilter("archived")}>
            보관된 프로젝트 보기
          </Button>
        </section>
      )}
      {!ui.showCreatePrompt &&
        !ui.list.loading &&
        !ui.list.error &&
        ui.projects.length === 0 && (
          <EmptyState
            title={
              ui.search ? "검색 결과가 없어요" : "보관된 프로젝트가 없어요"
            }
          >
            {ui.search
              ? "다른 이름으로 검색해보세요."
              : "사용 중인 프로젝트는 목록 범위를 바꿔 확인하세요."}
          </EmptyState>
        )}
      <Dialog open={ui.creating} title="새 프로젝트" onClose={ui.closeCreate}>
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
              onChange={(e) => {
                const level = CEO_LEVELS.find((v) => v === e.target.value);
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
    </div>
  );
}
