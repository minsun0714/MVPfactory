"use client";
import Image from "next/image";
import Link from "next/link";
import { useOfficePreview, team } from "@/hooks/useOfficePreview";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, TextArea } from "@/components/ui/Field";
import { Badge, Card, EmptyState } from "@/components/ui/Status";
import { Tabs } from "@/components/ui/Tabs";
import { PixelIcon } from "@/components/ui/PixelIcon";

const menu = [
  { id: "projects", label: "프로젝트" },
  { id: "palette", label: "꾸미기" },
  { id: "settings", label: "설정" },
  { id: "bell", label: "알림" },
] as const;
const tabs = [
  { id: "conversation", label: "대화" },
  { id: "work", label: "작업" },
  { id: "artifacts", label: "산출물" },
];
const titles = {
  projects: "프로젝트",
  palette: "우리 회사 꾸미기",
  settings: "공통 설정",
  bell: "알림함",
  meeting: "우리 팀 회의실",
  pm: "PM",
  planner: "기획자",
  designer: "디자이너",
  developer: "개발자",
};
export function OfficePreview() {
  const ui = useOfficePreview();
  return (
    <div
      className="factory-ui office-page"
      data-reduced-motion={ui.reducedMotion}
    >
      <a className="pixel-skip-link" href="#office-content">
        사무실 내용으로 건너뛰기
      </a>
      <aside className="office-rail" aria-label="회사 도구">
        <Link className="office-mark" href="/office" aria-label="나의 사무실">
          <PixelIcon name="office" width="28" height="28" />
        </Link>
        <nav aria-label="주 메뉴">
          {menu.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => ui.openPanel(item.id)}
              aria-haspopup="dialog"
              aria-label={item.label}
              className={ui.panel === item.id ? "is-active" : ""}
            >
              <PixelIcon name={item.id} width="24" height="24" />
              <span>{item.label}</span>
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
            <h1>{ui.projectName}</h1>
          </div>
          <Badge>화면 미리보기</Badge>
        </div>
        <div className="office-intro">
          <span className="office-dot" aria-hidden="true" />
          <p>좋은 아이디어는, 함께 만드는 것부터.</p>
          <span className="pixel-muted">팀원을 눌러 만나보세요.</span>
        </div>
        <div className="office-viewport">
          <div
            className="office-stage"
            style={{ transform: `scale(${ui.zoom / 100})` }}
          >
            <Image
              src="/assets/office/room.svg"
              width={1300}
              height={660}
              alt="넓은 사무실. 왼쪽에 PM과 기획자, 오른쪽에 모니터 2대의 디자이너와 3대의 개발자, 중앙에 4인 원탁이 있습니다."
              priority
              unoptimized
            />
            {team.map((member) => (
              <button
                key={member.id}
                className={`office-character role-${member.color}`}
                style={{ left: `${member.x}%`, top: `${member.y}%` }}
                aria-label={`${member.name} 업무 보기`}
                aria-haspopup="dialog"
                onClick={() => ui.openPanel(member.id)}
              >
                <span className="office-character-target" aria-hidden="true" />
                <span className="office-name">
                  <span className="role-dot" />
                  {member.name}
                  <PixelIcon name="chat" width="14" height="14" />
                </span>
              </button>
            ))}
            <button
              className="office-meeting"
              aria-haspopup="dialog"
              onClick={() => ui.openPanel("meeting")}
            >
              <PixelIcon name="chat" />
              회의실 둘러보기
            </button>
          </div>
        </div>
        <div className="office-bottom">
          <p className="pixel-muted">
            아직 실행 중인 작업이 없어요.
            <br />
            <span>지금은 API 없이 화면과 조작을 확인할 수 있어요.</span>
          </p>
          <div className="office-zoom" aria-label="사무실 확대 및 축소">
            <Button
              variant="ghost"
              aria-label="축소"
              disabled={ui.zoom <= 80}
              onClick={ui.zoomOut}
            >
              <PixelIcon name="minus" />
            </Button>
            <Button
              variant="ghost"
              aria-label="배율 초기화"
              onClick={ui.resetZoom}
            >
              {ui.zoom}%
            </Button>
            <Button
              variant="ghost"
              aria-label="확대"
              disabled={ui.zoom >= 125}
              onClick={ui.zoomIn}
            >
              <PixelIcon name="plus" />
            </Button>
          </div>
        </div>
        <div className="office-mobile-team" aria-label="팀원 목록">
          {team.map((member) => (
            <button
              className={`role-${member.color}`}
              key={member.id}
              onClick={() => ui.openPanel(member.id)}
            >
              <span className="role-dot" />
              <span>{member.name}</span>
              <PixelIcon name="arrow" />
            </button>
          ))}
        </div>
      </section>
      <Dialog
        open={ui.panel !== null}
        title={ui.panel ? titles[ui.panel] : ""}
        description={ui.role?.title}
        onClose={ui.closePanel}
      >
        {ui.role && (
          <Tabs items={tabs} value={ui.tab} onChange={ui.setTab}>
            {ui.tab === "conversation" && (
              <div className="pixel-stack">
                <div className={`office-message role-${ui.role.color}`}>
                  <span className="role-dot" />
                  <div>
                    <strong>{ui.role.name}</strong>
                    <p>{ui.role.description}</p>
                    <span className="pixel-muted">
                      소개 문구 · 실제 AI 대화가 아닙니다
                    </span>
                  </div>
                </div>
                <TextArea
                  label="메모"
                  value={ui.note}
                  onChange={(event) => ui.setNote(event.target.value)}
                  placeholder="팀원과 나누고 싶은 생각을 적어두세요."
                  hint="이 화면 안에서만 유지되는 메모예요. 새로고침하면 사라집니다."
                />
              </div>
            )}
            {ui.tab === "work" && (
              <EmptyState title="아직 작업이 없어요">
                프로젝트가 실행되면 이곳에서 역할별 진행 상황을 확인해요.
              </EmptyState>
            )}
            {ui.tab === "artifacts" && (
              <EmptyState title="산출물이 준비되면 모아둘게요">
                기획서, 디자인, 코드 등 실제 결과물을 여기서 확인하게 돼요.
              </EmptyState>
            )}
          </Tabs>
        )}
        {ui.panel === "projects" && (
          <form
            className="pixel-stack"
            onSubmit={(event) => {
              event.preventDefault();
              ui.applyPreviewName();
            }}
          >
            <Badge>로컬 화면 예시</Badge>
            <Field
              label="프로젝트 이름"
              value={ui.draftName}
              maxLength={60}
              required
              onChange={(event) => ui.setDraftName(event.target.value)}
              hint="실제 프로젝트를 만들거나 서버에 저장하지 않습니다."
            />
            <Button type="submit" disabled={!ui.draftName.trim()}>
              미리보기에 적용
              <PixelIcon name="arrow" />
            </Button>
          </form>
        )}
        {ui.panel === "palette" && (
          <div className="pixel-stack">
            <p className="mobile-only">꾸미기는 PC에서 사용할 수 있어요.</p>
            <p>
              월넛 사무실과 네 명의 픽셀 팀원. 역할별 색과 도구로 서로를 알아볼
              수 있어요.
            </p>
            <div className="office-swatch-grid">
              {team.map((member) => (
                <Card key={member.id} className={`role-${member.color}`}>
                  <span className="office-swatch" />
                  <strong>{member.name}</strong>
                </Card>
              ))}
            </div>
            <Badge>꾸미기 편집기 준비 중</Badge>
            <p className="pixel-muted">
              현재는 외형 미리보기입니다. 의상 조합·가구 배치·저장은 아직
              연결하지 않았어요.
            </p>
          </div>
        )}
        {ui.panel === "settings" && (
          <div className="pixel-stack">
            <label className="pixel-check">
              <input
                type="checkbox"
                checked={ui.reducedMotion}
                onChange={(event) => ui.setReducedMotion(event.target.checked)}
              />
              <span>
                화면 움직임 줄이기
                <small>이 화면에서 적용됩니다. 소리는 재생하지 않아요.</small>
              </span>
            </label>
            <Card>
              <h3>공통 계정</h3>
              <p>GitHub · Vercel · DB 설정을 모든 프로젝트가 공유해요.</p>
              <Badge>연결 상태 미조회</Badge>
              <p className="pixel-muted">
                API 연결 전에는 계정이나 비밀 키를 입력받지 않습니다.
              </p>
            </Card>
          </div>
        )}
        {ui.panel === "bell" && (
          <EmptyState title="아직 도착한 알림이 없어요">
            작업 완료와 오류, 대표님의 결정이 필요한 순간을 알려드릴게요.
          </EmptyState>
        )}
        {ui.panel === "meeting" && (
          <div className="pixel-stack">
            <Badge>회의 없음</Badge>
            <h3>네 개의 자리, 하나의 아이디어</h3>
            <p>
              기획과 디자인을 함께 검토할 때 이 원탁에 모여요. 실제 회의
              이벤트가 연결되면 참여자와 발언을 보여드립니다.
            </p>
            <p className="pixel-muted">
              현재 사무실은 정적인 화면입니다. 실제 회의나 AI 작업이 진행 중인
              상태는 아닙니다.
            </p>
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
