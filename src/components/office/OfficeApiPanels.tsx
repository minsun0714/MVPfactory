"use client";
import { useState } from "react";
import { apiPaths } from "@/contracts/paths";
import { INPUT_LIMITS } from "@/contracts/common";
import type {
  Artifact,
  Meeting,
  OfficeState,
  RoleId,
  RunEventsPage,
} from "@/contracts";
import { useOfficeResource } from "@/hooks/useOfficeResource";
import type { useDecisionReview } from "@/hooks/useDecisionReview";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Field";
import { Badge, Card, EmptyState } from "@/components/ui/Status";
import { Tabs } from "@/components/ui/Tabs";

export function QueryNotice({
  loading,
  error,
  retry,
}: {
  loading?: boolean;
  error?: string | null;
  retry: () => void;
}) {
  if (error)
    return (
      <div className="pixel-stack" role="alert">
        <p className="pixel-error-text">{error}</p>
        <Button variant="secondary" onClick={retry}>
          다시 불러오기
        </Button>
      </div>
    );
  if (loading)
    return (
      <p role="status" className="pixel-muted">
        불러오는 중…
      </p>
    );
  return null;
}
export function DecisionReview({
  review,
}: {
  review: ReturnType<typeof useDecisionReview>;
}) {
  const d = review.decision;
  return (
    <div className="pixel-stack">
      <QueryNotice
        loading={review.loading}
        error={review.error}
        retry={review.reload}
      />
      {d && (
        <>
          <div className="pixel-stack">
            <strong>
              대상 프로젝트: {review.project.data?.name ?? d.projectId}
            </strong>
            <QueryNotice {...review.project} retry={review.project.reload} />
          </div>
          <div className="pixel-wrap">
            <Badge>제안 {d.proposalVersion}</Badge>
            <Badge>{d.status === "OPEN" ? "응답 대기" : "응답 종료"}</Badge>
          </div>
          <h3>{d.title}</h3>
          <p>{d.summary}</p>
          {d.proposal.map((section, index) => (
            <Card key={index}>
              <h3>{section.heading}</h3>
              <ul>
                {section.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </Card>
          ))}
          {d.changesFromPrevious.length > 0 && (
            <div>
              <h3>이전 제안과 달라진 점</h3>
              <ul>
                {d.changesFromPrevious.map((change, i) => (
                  <li key={i}>{change}</li>
                ))}
              </ul>
            </div>
          )}
          {d.status === "OPEN" ? (
            <>
              <TextArea
                label="의견 또는 수정 요청"
                value={review.draft.comment}
                maxLength={INPUT_LIMITS.decisionComment}
                disabled={review.pending}
                onChange={(e) => review.changeDraft("comment", e.target.value)}
                hint="수정 요청에는 의견이 필요합니다. 최신 제안을 다시 불러와도 입력은 유지됩니다."
              />
              {d.kind === "EXCEPTION" && (
                <fieldset className="pixel-radio-group">
                  <legend>진행 방법 선택</legend>
                  {d.options.map((option) => (
                    <label className="pixel-check" key={option.id}>
                      <input
                        type="radio"
                        name="decision-option"
                        value={option.id}
                        checked={review.draft.optionId === option.id}
                        disabled={review.pending}
                        onChange={() =>
                          review.changeDraft("optionId", option.id)
                        }
                      />
                      <span>
                        {option.label}
                        <small>{option.description}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {review.failure && (
                <div role="alert">
                  <p className="pixel-error-text">{review.failure.message}</p>
                  {review.failure.conflict && (
                    <Button variant="secondary" onClick={review.reload}>
                      최신 제안 확인
                    </Button>
                  )}
                </div>
              )}
              <div className="pixel-wrap">
                {d.kind === "EXCEPTION" ? (
                  <Button
                    pending={review.pending}
                    disabled={
                      !review.project.data ||
                      !review.draft.optionId ||
                      !!review.failure?.conflict
                    }
                    onClick={() => review.submit("SELECT_OPTION")}
                  >
                    선택한 방법으로 응답
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      disabled={
                        !review.project.data ||
                        review.pending ||
                        !!review.failure?.conflict
                      }
                      onClick={() => review.submit("REQUEST_CHANGES")}
                    >
                      수정 요청
                    </Button>
                    <Button
                      pending={review.pending}
                      disabled={
                        !review.project.data || !!review.failure?.conflict
                      }
                      onClick={() => review.submit("APPROVE")}
                    >
                      승인하고 계속
                    </Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <p>
              이 결정은 더 이상 응답할 수 없습니다. 알림과 진행 상태를 새로
              확인해주세요.
            </p>
          )}
        </>
      )}
    </div>
  );
}
export function RoleApiPanel({
  state,
  role,
}: {
  state: OfficeState | undefined;
  role: RoleId;
}) {
  const [tab, setTab] = useState("work");
  const activity = state?.roles.find((r) => r.role === role);
  const events = useOfficeResource<RunEventsPage>(
    state?.run ? `${apiPaths.runEvents(state.run.id)}?limit=100` : null,
    state?.lastSequence,
  );
  const artifact = useOfficeResource<Artifact>(
    activity?.latestArtifactId
      ? apiPaths.artifact(activity.latestArtifactId)
      : null,
  );
  return (
    <Tabs
      value={tab}
      onChange={setTab}
      items={[
        { id: "work", label: "작업" },
        { id: "events", label: "기록" },
        { id: "artifact", label: "산출물" },
      ]}
    >
      {tab === "work" &&
        (state ? (
          <div className="pixel-stack">
            <Badge>{activity?.status ?? "IDLE"}</Badge>
            <p>{activity?.currentTask ?? "진행 중인 작업이 없습니다."}</p>
            {state.run && (
              <>
                <p>현재 단계: {state.run.stage?.label ?? "대기"}</p>
                <p>
                  모델 호출 {state.run.usage.modelCalls}회 · 수정 시도{" "}
                  {state.run.usage.fixAttempts}회
                </p>
                {state.run.failure && (
                  <p className="pixel-error-text">
                    {state.run.failure.message}
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <EmptyState title="프로젝트 상태를 먼저 확인해주세요">
            프로젝트를 선택하면 실제 작업 정보를 보여드립니다.
          </EmptyState>
        ))}
      {tab === "events" && (
        <>
          <QueryNotice
            loading={events.loading}
            error={events.error}
            retry={events.reload}
          />
          {events.data?.items
            .filter((e) => e.role === role)
            .map((event) => (
              <Card key={event.sequence}>
                <p>{event.summary || event.type}</p>
                <small className="pixel-muted">
                  #{event.sequence} ·{" "}
                  {new Date(event.occurredAt).toLocaleString("ko-KR")}
                </small>
              </Card>
            ))}
          {!events.loading &&
            !events.error &&
            !events.data?.items.some((e) => e.role === role) && (
              <EmptyState title="아직 작업 기록이 없어요">
                서버에 기록된 활동이 표시됩니다.
              </EmptyState>
            )}
          {events.data && events.data.items.length >= 100 && (
            <p className="pixel-muted">
              처음 100개 이벤트에서 이 역할의 기록을 표시합니다.
            </p>
          )}
        </>
      )}
      {tab === "artifact" && (
        <>
          <QueryNotice
            loading={artifact.loading}
            error={artifact.error}
            retry={artifact.reload}
          />
          {artifact.data ? (
            <div>
              <h3>{artifact.data.title}</h3>
              <pre className="office-artifact">
                {artifact.data.content
                  ? JSON.stringify(artifact.data.content, null, 2)
                  : "본문이 없는 산출물입니다."}
              </pre>
              {safeUrl(artifact.data.downloadUrl) && (
                <a
                  href={safeUrl(artifact.data.downloadUrl)}
                  target="_blank"
                  rel="noreferrer"
                >
                  산출물 열기
                </a>
              )}
            </div>
          ) : (
            !artifact.loading &&
            !artifact.error && (
              <EmptyState title="아직 산출물이 없어요">
                실제 결과물이 저장되면 이곳에서 볼 수 있습니다.
              </EmptyState>
            )
          )}
        </>
      )}
    </Tabs>
  );
}
function safeUrl(url: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol)
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function MeetingApiPanel({
  id,
  revision,
}: {
  id: string | null;
  revision?: number;
}) {
  const query = useOfficeResource<Meeting>(
    id ? apiPaths.meeting(id) : null,
    revision,
  );
  return (
    <div className="pixel-stack">
      <QueryNotice {...query} retry={query.reload} />
      {query.data ? (
        <>
          <Badge>{query.data.status}</Badge>
          <h3>{query.data.topic}</h3>
          <p>{query.data.participants.join(" · ")}</p>
          {query.data.statements.map((statement) => (
            <Card key={statement.sequence}>
              <strong>{statement.role}</strong>
              <p>{statement.summary}</p>
            </Card>
          ))}
          {query.data.outcome && <p>{query.data.outcome}</p>}
        </>
      ) : (
        !query.loading &&
        !query.error && (
          <EmptyState title="진행 중인 회의가 없습니다">
            실제 회의가 시작되면 주제와 발언을 표시합니다.
          </EmptyState>
        )
      )}
    </div>
  );
}
