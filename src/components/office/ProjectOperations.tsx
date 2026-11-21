"use client";
import { Dialog } from "@/components/ui/Dialog";
import { Tabs } from "@/components/ui/Tabs";
import { useState } from "react";
import Link from "next/link";
import { ExecutionResult } from "@/components/office/ExecutionResult";
import type {
  Artifact,
  ArtifactSummary,
  MeetingSummary,
  Page,
  Run,
  RunUsageResponse,
  VerificationReport,
} from "@/contracts";
import { apiPaths } from "@/contracts/paths";
import { useProjectOperations } from "@/hooks/useProjectOperations";
import { useOfficeResource } from "@/hooks/useOfficeResource";
import { useOfficeCommand } from "@/hooks/useOfficeCommand";
import { useRunControl } from "@/hooks/useRunControl";
import { Button } from "@/components/ui/Button";
import { Select, TextArea } from "@/components/ui/Field";
import { Card, Badge } from "@/components/ui/Status";
import {
  QueryNotice,
  MeetingApiPanel,
} from "@/components/office/OfficeApiPanels";
export function CommandNotice({
  command,
}: {
  command: ReturnType<typeof useOfficeCommand>;
}) {
  return (
    <>
      {command.error && (
        <p role="alert" className="pixel-error-text">
          {command.error}
        </p>
      )}
    </>
  );
}
export function SafeLink({
  url,
  children,
}: {
  url: string | null | undefined;
  children: React.ReactNode;
}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
export function ProjectOperations({
  id,
  refresh,
  revision,
}: {
  id: string;
  refresh: () => void;
  revision?: number;
}) {
  const ui = useProjectOperations(id, refresh, revision);
  const p = ui.project.data;
  const [revising, setRevising] = useState(false);
  return (
    <section className="execution-workspace" aria-label="프로젝트 실행 관리">
      <QueryNotice {...ui.project} retry={ui.project.reload} />
      {p && (
        <>
          <div className="execution-heading">
            <div>
              <h1>{p.name}</h1>
              <p className="execution-idea">{p.idea}</p>
            </div>
            <Badge>
              {p.archived
                ? "보관된 프로젝트"
                : p.latestRun
                  ? runStatusLabels[p.latestRun.status]
                  : "시작 전"}
            </Badge>
          </div>
          {(p.hasLiveApp ||
            (p.latestRun &&
              ["SUCCEEDED", "FAILED"].includes(p.latestRun.status))) && (
            <ExecutionResult id={id} revision={revision} />
          )}
          {p.archived ? (
            <div className="execution-launch">
              <h2>보관 중인 프로젝트예요</h2>
              <p>이어서 작업하려면 프로젝트를 복원하세요.</p>
              <Button pending={ui.command.pending} onClick={ui.archive}>
                프로젝트 복원
              </Button>
            </div>
          ) : !p.latestRun ? (
            <div className="execution-launch">
              <div className="execution-launch-copy">
                <h2>아이디어를 팀에 맡겨보세요</h2>
                <p>팀이 기획부터 앱 생성·배포까지 진행합니다.</p>
              </div>
              <fieldset
                disabled={ui.command.pending}
                className="execution-launch-controls"
              >
                <RunSetup ui={ui} />
                <Button
                  pending={ui.command.pending}
                  disabled={!ui.readiness.data?.available}
                  onClick={ui.start}
                >
                  실행 시작
                </Button>
              </fieldset>
            </div>
          ) : (
            ui.canRevise && (
              <>
                <div className="pixel-wrap">
                  <Button onClick={() => setRevising(true)}>수정 요청</Button>
                </div>
                <Dialog
                  open={revising}
                  title="수정 요청"
                  onClose={() => {
                    if (!ui.command.pending) setRevising(false);
                  }}
                >
                  <fieldset
                    disabled={ui.command.pending}
                    className="pixel-stack"
                  >
                    <TextArea
                      label="어떤 부분을 바꿀까요?"
                      placeholder="예: 메모에 태그를 붙이고 검색할 수 있게 해주세요."
                      maxLength={4000}
                      value={ui.feedback}
                      onChange={(e) => ui.setFeedback(e.target.value)}
                    />
                    <RunSetup ui={ui} revisionRequest />
                    <Button
                      disabled={
                        !ui.feedback.trim() || !ui.readiness.data?.available
                      }
                      pending={ui.command.pending}
                      onClick={ui.start}
                    >
                      수정 작업 시작
                    </Button>
                  </fieldset>
                  <CommandNotice command={ui.command} />
                </Dialog>
              </>
            )
          )}
          <CommandNotice command={ui.command} />
          {p.latestRun && (
            <>
              {!["SUCCEEDED"].includes(p.latestRun.status) && (
                <RunOperations
                  id={p.latestRun.id}
                  revision={revision}
                  refresh={ui.reload}
                  compact
                />
              )}
              <div className="pixel-wrap">
                <Link href={`/projects/${encodeURIComponent(id)}/history`}>
                  작업 기록 보기
                </Link>
                {!["SUCCEEDED", "FAILED"].includes(p.latestRun.status) && (
                  <Link href={`/office?project=${encodeURIComponent(id)}`}>
                    사무실에서 진행 보기
                  </Link>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
const runStatusLabels = {
  QUEUED: "실행 대기",
  RUNNING: "작업 중",
  WAITING_CEO: "대표님 검토 대기",
  PAUSED: "일시정지",
  BLOCKED: "확인 필요",
  FAILED: "작업 실패",
  SUCCEEDED: "실행 완료",
};
function RunSetup({
  ui,
  revisionRequest = false,
}: {
  ui: ReturnType<typeof useProjectOperations>;
  revisionRequest?: boolean;
}) {
  return (
    <div className="execution-setup">
      <div className="pixel-stack">
        <QueryNotice {...ui.readiness} retry={ui.readiness.reload} />
        {ui.readiness.data && (
          <p className="pixel-muted" role="status">
            {ui.readiness.data.available
              ? "저장된 공통 계정과 실행 한도를 사용해요."
              : ui.readiness.data.reason}
          </p>
        )}
        <Link href="/office?panel=settings">공통 계정·공개 범위·한도 확인</Link>
        {!revisionRequest && (
          <Button
            variant="secondary"
            onClick={ui.checkScope}
            disabled={ui.command.pending}
          >
            아이디어 지원 범위 확인
          </Button>
        )}
        {ui.scope && (
          <div role="status">
            <p>
              {ui.scope.supported
                ? "지원하는 범위의 아이디어예요."
                : "시작 전에 요구사항을 조정해주세요."}
            </p>
            {ui.scope.gaps.map((g, i) => (
              <p key={i}>
                {g.requirement}: {g.reason} {g.alternative}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function RunOperations({
  id,
  revision,
  refresh,
  compact = false,
}: {
  id: string;
  revision?: number;
  refresh: () => void;
  compact?: boolean;
}) {
  const run = useOfficeResource<Run>(apiPaths.run(id), revision);
  const usage = useOfficeResource<RunUsageResponse>(
    apiPaths.runUsage(id),
    revision,
  );
  const artifacts = useOfficeResource<Page<ArtifactSummary>>(
    apiPaths.runArtifacts(id),
    revision,
  );
  const meetings = useOfficeResource<Page<MeetingSummary>>(
    apiPaths.runMeetings(id),
    revision,
  );
  const verification = useOfficeResource<VerificationReport>(
    apiPaths.runVerification(id),
    revision,
  );
  const [tab, setTab] = useState("artifacts");
  const [artifactId, setArtifactId] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const artifact = useOfficeResource<Artifact>(
    artifactId ? apiPaths.artifact(artifactId) : null,
  );
  const command = useRunControl(id, () => {
    run.reload();
    refresh();
  });
  const r = run.data;
  return (
    <div className="pixel-stack">
      <QueryNotice {...run} retry={run.reload} />
      {r && (
        <>
          <div className="pixel-wrap">
            <Badge>{runStatusLabels[r.status]}</Badge>
            <span className="pixel-muted">
              {r.mode === "DEMO" ? "과거 데모 기록" : "앱 생성 실행"}
            </span>
          </div>
          <p>
            {r.failure?.message ??
              (r.blockedReason
                ? blockedLabels[r.blockedReason]
                : (r.stage?.label ?? runDescriptions[r.status]))}
          </p>
          {r.status === "WAITING_CEO" && (
            <Link href={`/office?project=${encodeURIComponent(r.projectId)}`}>
              사무실에서 제안 검토하기
            </Link>
          )}
          {r.pauseRequested && (
            <p role="status">안전한 지점에서 정지하기를 기다리고 있습니다.</p>
          )}
          <div className="pixel-wrap">
            {(["pause", "resume", "retry"] as const)
              .filter((action) =>
                r.mode === "DEMO"
                  ? false
                  : action === "pause"
                    ? !["PAUSED", "FAILED", "SUCCEEDED"].includes(r.status) &&
                      !r.pauseRequested
                    : action === "resume"
                      ? r.status === "PAUSED" || r.pauseRequested
                      : r.status === "FAILED",
              )
              .map((action) => (
                <Button
                  key={action}
                  variant="secondary"
                  disabled={
                    command.pending ||
                    (action === "pause"
                      ? ["PAUSED", "FAILED", "SUCCEEDED"].includes(r.status) ||
                        r.pauseRequested
                      : action === "resume"
                        ? r.status !== "PAUSED" && !r.pauseRequested
                        : r.status !== "FAILED")
                  }
                  onClick={() => command.control(action)}
                >
                  {
                    {
                      pause: "일시정지",
                      resume: "재개",
                      retry: "같은 실행 재시도",
                    }[action]
                  }
                </Button>
              ))}
          </div>
        </>
      )}
      <CommandNotice command={command} />
      {!compact && (
        <Tabs
          value={tab}
          onChange={setTab}
          label="작업 기록 종류"
          items={[
            { id: "artifacts", label: "산출물" },
            { id: "meetings", label: "회의" },
            { id: "verification", label: "검증" },
            { id: "usage", label: "사용량" },
          ]}
        >
          {tab === "usage" && (
            <section className="pixel-stack">
              <QueryNotice {...usage} retry={usage.reload} />
              {usage.data && (
                <p>
                  모델 {usage.data.usage.modelCalls} /{" "}
                  {usage.data.limits.maxModelCalls ?? "미설정"}회 · 수정{" "}
                  {usage.data.usage.fixAttempts} /{" "}
                  {usage.data.limits.maxFixAttempts ?? "미설정"}회<br />
                  실행 {usage.data.usage.activeSeconds} /{" "}
                  {usage.data.limits.maxActiveSeconds ?? "미설정"}초 · 응답 대기{" "}
                  {usage.data.usage.waitingSeconds}초<br />
                  예상 비용{" "}
                  {usage.data.usage.estimatedCost
                    ? `${usage.data.usage.estimatedCost.amount} ${usage.data.usage.estimatedCost.currency}`
                    : "미집계"}{" "}
                  · 비용 한도 {usage.data.limits.maxEstimatedCost ?? "미설정"}
                </p>
              )}
            </section>
          )}
          {tab === "artifacts" && (
            <section className="pixel-stack">
              <QueryNotice {...artifacts} retry={artifacts.reload} />
              {artifacts.data?.items.map((a) => (
                <Button
                  variant="secondary"
                  key={a.id}
                  onClick={() => setArtifactId(a.id)}
                >
                  {a.author} · {a.title}
                </Button>
              ))}
              {artifacts.data?.items.length === 0 && <p>산출물이 없습니다.</p>}
              <QueryNotice {...artifact} retry={artifact.reload} />
              {artifact.data && (
                <Card>
                  <h4>{artifact.data.title}</h4>
                  <pre className="office-artifact">
                    {JSON.stringify(artifact.data.content, null, 2)}
                  </pre>
                  <SafeLink url={artifact.data.downloadUrl}>다운로드</SafeLink>
                </Card>
              )}
            </section>
          )}
          {tab === "meetings" && (
            <section className="pixel-stack">
              <QueryNotice {...meetings} retry={meetings.reload} />
              {meetings.data?.items.map((m) => (
                <Button
                  variant="secondary"
                  key={m.id}
                  onClick={() => setMeetingId(m.id)}
                >
                  {m.topic}
                </Button>
              ))}
              {meetings.data?.items.length === 0 && (
                <p>회의 기록이 없습니다.</p>
              )}
              {meetingId && (
                <MeetingApiPanel id={meetingId} revision={revision} />
              )}
            </section>
          )}
          {tab === "verification" && (
            <section className="pixel-stack">
              <QueryNotice {...verification} retry={verification.reload} />
              {r?.mode === "DEMO" && (
                <p>
                  과거 데모 기록입니다. 실제 앱의 빌드·배포·제품 검증은 실행되지
                  않았어요.
                </p>
              )}
              {r?.mode !== "DEMO" &&
                verification.data?.items.map((v) => (
                  <Card key={v.id}>
                    <Badge>
                      {
                        {
                          PASS: "통과",
                          FAIL: "실패",
                          NOT_RUN: "검증 전",
                          NOT_APPLICABLE: "해당 없음",
                        }[v.result]
                      }
                    </Badge>
                    <p>{v.description}</p>
                    <p>
                      {v.evidence} {v.reason}
                    </p>
                  </Card>
                ))}
              {r?.mode !== "DEMO" && verification.data?.items.length === 0 && (
                <p>아직 검증하지 않았습니다.</p>
              )}
            </section>
          )}
        </Tabs>
      )}
    </div>
  );
}

const blockedLabels = {
  CONNECTION_MISSING: "계정 연결을 확인해주세요.",
  PERMISSION_DENIED: "연결 계정의 권한을 확인해주세요.",
  LIMIT_REACHED: "실행 한도에 도달했어요.",
  EXTERNAL_RESULT_UNKNOWN: "외부 작업 결과를 확인하고 있어요.",
  WORKER_UNAVAILABLE: "작업 서버를 확인해주세요.",
};

const runDescriptions = {
  QUEUED: "작업 서버가 실행을 시작하기를 기다리고 있어요.",
  RUNNING: "팀이 작업하고 있어요. 진행 상태는 자동으로 갱신돼요.",
  WAITING_CEO: "다음 단계로 진행하려면 대표님의 검토가 필요해요.",
  PAUSED: "작업을 잠시 멈췄어요. 준비되면 이어서 진행하세요.",
  BLOCKED: "진행을 막고 있는 항목을 확인해주세요.",
  FAILED: "작업이 중단됐어요. 원인을 확인한 후 다시 시도하세요.",
  SUCCEEDED: "이번 실행을 마쳤어요. 결과와 작업 기록을 확인하세요.",
};

export function ProjectRunHistory({
  id,
  revision,
  refresh,
}: {
  id: string;
  revision?: number;
  refresh: () => void;
}) {
  const ui = useProjectOperations(id, refresh, revision);
  return (
    <section className="execution-workspace">
      <h1>{ui.project.data?.name ?? "프로젝트"} · 작업 기록</h1>
      <QueryNotice {...ui.project} retry={ui.project.reload} />
      {ui.project.data?.confirmedSpec && (
        <p>{ui.project.data.confirmedSpec.summary}</p>
      )}
      <QueryNotice {...ui.runs} retry={ui.runs.reload} />
      {ui.runs.data?.items.length === 0 && <p>아직 실행한 작업이 없어요.</p>}
      {ui.runId && (
        <>
          <Select
            label="실행 선택"
            value={ui.runId}
            onChange={(e) => ui.setSelectedRun(e.target.value)}
          >
            {ui.runs.data?.items.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.createdAt).toLocaleString("ko-KR")} ·{" "}
                {r.mode === "DEMO" ? "과거 데모" : "앱 생성"} ·{" "}
                {runStatusLabels[r.status]}
              </option>
            ))}
          </Select>
          <RunOperations
            key={ui.runId}
            id={ui.runId}
            revision={revision}
            refresh={ui.reload}
          />
        </>
      )}
    </section>
  );
}
