"use client";
import Image from "next/image";
import type { OfficeState, RoleId } from "@/contracts";
import { useOfficeScene } from "@/hooks/useOfficeScene";
import { actors, SCENE_SIZE } from "@/components/office/scene/model";
import { Button } from "@/components/ui/Button";
import { DeveloperDelivery } from "@/components/office/DeveloperDelivery";
import { deliveryRunId } from "@/components/office/scene/model";
export function PixiOfficeScene({
  state,
  zoom,
  disabled,
  onRole,
  onMeeting,
  onRevisionSubmitted,
}: {
  state?: OfficeState;
  zoom: number;
  disabled: boolean;
  onRole: (role: RoleId) => void;
  onMeeting: () => void;
  onRevisionSubmitted: () => void;
}) {
  const { host, ready, error, statement, meetingError, retry, deliveredRunId } =
    useOfficeScene(state, onRole, onMeeting, disabled);
  const deliveryId = deliveryRunId(state);
  return (
    <section className="office-scene" aria-label="사무실과 회의실">
      <div className="office-viewport">
        <div
          className="office-stage office-pixi-stage"
          style={{ transform: `scale(${zoom / 100})` }}
        >
          <div ref={host} className="office-pixi-canvas" />
          {!ready && (
            <Image
              src="/assets/office/room.svg"
              width={1300}
              height={660}
              alt="네 명의 개인 책상과 중앙 원탁이 있는 사무실"
              priority
              unoptimized
            />
          )}
          {ready && state?.activeMeeting && statement && (
            <button
              key={`${state.activeMeeting.id}:${statement.sequence}`}
              type="button"
              className="office-speech-bubble"
              onClick={onMeeting}
              disabled={disabled}
              aria-label={`${actors[statement.role].label}: ${statement.summary}. 회의 기록 보기`}
              style={{
                left: `${((actors[statement.role].seatX - SCENE_SIZE.originX) / SCENE_SIZE.width) * 100}%`,
                top: `${((actors[statement.role].seatY - SCENE_SIZE.originY - 146) / SCENE_SIZE.height) * 100}%`,
              }}
            >
              <strong>{actors[statement.role].label}</strong>
              <span>{statement.summary}</span>
              <small>회의 기록 보기</small>
            </button>
          )}
          {state && deliveryId && (deliveredRunId === deliveryId || error) && (
            <DeveloperDelivery
              key={`${state.project.id}:${deliveryId}`}
              state={state}
              onSubmitted={onRevisionSubmitted}
            />
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="pixel-wrap">
          <span>
            움직이는 사무실을 불러오지 못해 기본 그림을 표시하고 있어요.
          </span>
          <Button variant="secondary" onClick={retry}>
            다시 불러오기
          </Button>
        </div>
      )}
      <div className="office-keyboard-controls" aria-label="키보드 사무실 조작">
        {(Object.keys(actors) as RoleId[]).map((role) => (
          <Button
            key={role}
            variant="ghost"
            disabled={disabled}
            onClick={() => onRole(role)}
          >
            {actors[role].label} 업무 보기
          </Button>
        ))}
        <Button variant="ghost" disabled={disabled} onClick={onMeeting}>
          회의 기록
        </Button>
      </div>
      {state?.activeMeeting && (
        <div
          className="office-meeting-summary"
          role="status"
          aria-live="polite"
        >
          <strong>{state.activeMeeting.topic}</strong>
          <p>
            {state.activeMeeting.participants
              .map((r) => actors[r].label)
              .join(" · ")}
            {state.activeMeeting.status === "WAITING_CEO"
              ? " — 대표님 검토 대기"
              : ""}
          </p>
          {statement && (
            <p>
              {actors[statement.role].label}: {statement.summary}
            </p>
          )}
          {!statement && !meetingError && (
            <p>
              {state.activeMeeting.status === "ENDED"
                ? "회의를 마치고 자리로 돌아가고 있어요."
                : state.activeMeeting.status === "FAILED"
                  ? "회의 진행 중 문제가 생겨 확인을 기다리고 있어요."
                  : state.activeMeeting.status === "INTERRUPTED"
                    ? "회의가 잠시 멈췄어요."
                    : state.activeMeeting.status === "WAITING_CEO"
                      ? "대표님의 검토를 기다리고 있어요."
                      : "회의에 모여 첫 발언을 준비하고 있어요."}
            </p>
          )}
          {meetingError && (
            <p>발언을 불러오지 못했어요. 회의 기록에서 다시 확인해주세요.</p>
          )}
        </div>
      )}
    </section>
  );
}
