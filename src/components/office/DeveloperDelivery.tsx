"use client";
import type { OfficeState } from "@/contracts";
import { INPUT_LIMITS } from "@/contracts/common";
import { useDeliveryRequest } from "@/hooks/useDeliveryRequest";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/Field";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { isWebUrl } from "@/components/ui/external-url";
import { DELIVERY_SPOT, SCENE_SIZE } from "@/components/office/scene/model";

export function DeveloperDelivery({
  state,
  onSubmitted,
}: {
  state: OfficeState;
  onSubmitted: () => void;
}) {
  const ui = useDeliveryRequest(state, onSubmitted);
  const app = ui.currentResult?.app?.url;
  return (
    <aside
      className="developer-delivery"
      aria-label="개발자 노트북의 배포 결과"
      style={{
        left: `${((DELIVERY_SPOT.x + 10 - SCENE_SIZE.originX) / SCENE_SIZE.width) * 100}%`,
        bottom: `${((SCENE_SIZE.originY + SCENE_SIZE.height - DELIVERY_SPOT.y + 38) / SCENE_SIZE.height) * 100}%`,
      }}
    >
      <div className="delivery-laptop-screen">
        <div className="developer-delivery-heading" role="status">
          <PixelIcon name="check" width="20" height="20" />
          <h2>{isWebUrl(app) ? "앱이 준비됐어요" : "실행을 마쳤어요"}</h2>
        </div>
        <p className="developer-delivery-project">{state.project.name}</p>
        {ui.result.loading && <p role="status">배포 주소를 불러오고 있어요.</p>}
        {ui.result.error && (
          <div role="alert">
            <p>{ui.result.error}</p>
            <Button variant="secondary" onClick={ui.result.reload}>
              다시 불러오기
            </Button>
          </div>
        )}
        {isWebUrl(app) && (
          <a
            className="pixel-button pixel-button--primary delivery-app-link"
            href={app}
            target="_blank"
            rel="noopener noreferrer"
          >
            앱 열기
            <PixelIcon name="arrow" width="18" height="18" />
            <span className="sr-only">(새 창)</span>
          </a>
        )}
        {!ui.result.loading && !ui.result.error && !isWebUrl(app) && (
          <p>
            현재 실행의 배포 주소를 확인하지 못했어요.{" "}
            <button
              type="button"
              className="delivery-text-button"
              onClick={ui.result.reload}
            >
              다시 확인
            </button>
          </p>
        )}
        {ui.currentResult &&
          ui.currentResult.completion.product !== "COMPLETE" && (
            <p className="delivery-verification">
              기능 검증은 아직 남아 있어요.
            </p>
          )}
        {ui.submitted ? (
          <p role="status">수정 요청을 접수했어요. 팀이 이어서 작업합니다.</p>
        ) : (
          <>
            <Button
              variant="secondary"
              className="delivery-revise"
              aria-expanded={ui.expanded}
              aria-controls={ui.formId}
              disabled={ui.command.pending || state.project.archived}
              onClick={() => ui.setExpanded(!ui.expanded)}
            >
              <PixelIcon name="chat" width="18" height="18" />
              {ui.expanded ? "접기" : "수정 요청"}
            </Button>
            {state.project.archived && (
              <p>보관된 프로젝트는 복원 후 수정할 수 있어요.</p>
            )}
            <form
              aria-label="수정 요청"
              id={ui.formId}
              hidden={!ui.expanded}
              className="delivery-form"
              onSubmit={(event) => {
                event.preventDefault();
                ui.submit();
              }}
            >
              <TextArea
                label="어떤 부분을 바꿀까요?"
                value={ui.feedback}
                onChange={(event) => ui.setFeedback(event.target.value)}
                placeholder="예: 메모를 날짜별로 모아 보고 싶어요."
                maxLength={INPUT_LIMITS.feedback}
                rows={4}
                disabled={ui.command.pending}
                required
              />
              {ui.readiness.loading && (
                <p role="status">실행 준비 상태를 확인하고 있어요.</p>
              )}
              {(ui.readiness.error ||
                (ui.readiness.data && !ui.readiness.data.available)) && (
                <div role="alert">
                  <p>{ui.readiness.error ?? ui.readiness.data?.reason}</p>
                  <Button variant="ghost" onClick={ui.readiness.reload}>
                    준비 상태 다시 확인
                  </Button>
                </div>
              )}
              {ui.command.error && (
                <p role="alert" className="pixel-error-text">
                  {ui.command.error}
                </p>
              )}
              <Button
                type="submit"
                pending={ui.command.pending}
                disabled={!ui.canSubmit}
              >
                수정 시작
              </Button>
            </form>
          </>
        )}
      </div>
      <div className="delivery-laptop-base" aria-hidden="true">
        <div className="delivery-laptop-keys">
          {Array.from({ length: 30 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
        <div className="delivery-laptop-trackpad" />
      </div>
    </aside>
  );
}
