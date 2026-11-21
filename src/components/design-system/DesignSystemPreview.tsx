"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Field, TextArea, Select } from "@/components/ui/Field";
import { Badge, Card, EmptyState, Progress } from "@/components/ui/Status";
import { Dialog } from "@/components/ui/Dialog";
import { Tabs } from "@/components/ui/Tabs";
import { PixelIcon } from "@/components/ui/PixelIcon";

export function DesignSystemPreview() {
  const [tab, setTab] = useState("buttons");
  const [dialog, setDialog] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [name, setName] = useState("");
  return (
    <div className="factory-ui system-page">
      <div className="system-heading">
        <div>
          <span className="pixel-eyebrow">MVP FACTORY / DESIGN SYSTEM</span>
          <h1>작은 회사의 UI 도감</h1>
          <p className="pixel-muted">픽셀의 즐거움, 읽기 편한 업무 화면.</p>
        </div>
        <Link className="pixel-link-button" href="/office">
          사무실로 돌아가기 <PixelIcon name="arrow" />
        </Link>
      </div>
      <div className="system-intro">
        <Badge>API 없는 컴포넌트 미리보기</Badge>
        <p>
          아이보리와 월넛, 선명한 역할색. 최소한의 선과 넉넉한 간격으로
          만듭니다.
        </p>
      </div>
      <section className="system-colors" aria-label="색상 토큰">
        {[
          "background",
          "surface",
          "primary",
          "pm",
          "planner",
          "designer",
          "developer",
        ].map((color) => (
          <div key={color}>
            <span className={`system-color color-${color}`} />
            <code>{color}</code>
          </div>
        ))}
      </section>
      <Tabs
        label="컴포넌트 분류"
        items={[
          { id: "buttons", label: "버튼·상태" },
          { id: "fields", label: "입력" },
          { id: "feedback", label: "알림·팝업" },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === "buttons" && (
          <div className="system-grid">
            <Card>
              <span className="pixel-eyebrow">01 / ACTIONS</span>
              <h2>버튼</h2>
              <div className="pixel-wrap">
                <Button
                  onClick={() => setNotification("기본 버튼을 눌렀어요.")}
                >
                  시작하기
                  <PixelIcon name="arrow" />
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setNotification("보조 버튼을 눌렀어요.")}
                >
                  수정 요청
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setNotification("텍스트 버튼을 눌렀어요.")}
                >
                  나중에
                </Button>
                <Button
                  variant="danger"
                  onClick={() =>
                    setNotification(
                      "위험 버튼의 표현 예시예요. 삭제하지 않습니다.",
                    )
                  }
                >
                  삭제
                </Button>
                <Button disabled>사용 불가</Button>
                <Button pending>제출</Button>
              </div>
            </Card>
            <Card>
              <span className="pixel-eyebrow">02 / STATUS</span>
              <h2>상태와 진행</h2>
              <div className="pixel-wrap">
                <Badge>미리보기</Badge>
                <Badge tone="success">완료</Badge>
                <Badge tone="warning">응답 대기</Badge>
                <Badge tone="danger">실패</Badge>
              </div>
              <Progress value={60} label="예시 진행률" />
              <p className="pixel-muted">
                실제 작업 진행률이 아닌 컴포넌트 예시입니다.
              </p>
            </Card>
            <Card>
              <span className="pixel-eyebrow">03 / TYPE</span>
              <h2>픽셀 제목, 편안한 본문</h2>
              <p>
                긴 대화와 기획서는 일반 글꼴로 표시합니다. 제목과 버튼은 픽셀
                글꼴로 회사의 분위기를 이어갑니다.
              </p>
              <p className="pixel-muted">
                본문 16px · 여유 있는 줄 간격 · 로컬 Galmuri11
              </p>
            </Card>
            <Card>
              <EmptyState title="첫 아이디어를 기다리고 있어요">
                결과가 없을 때도 다음에 무엇을 할지 안내합니다.
              </EmptyState>
            </Card>
          </div>
        )}
        {tab === "fields" && (
          <div className="system-grid">
            <Card>
              <div className="pixel-stack">
                <h2>기본 입력</h2>
                <Field
                  label="프로젝트 이름"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="어떤 아이디어를 만들까요?"
                  hint="최대 60자까지 입력할 수 있어요."
                  maxLength={60}
                />
                <TextArea
                  label="아이디어"
                  placeholder="해결하고 싶은 작은 불편을 적어주세요."
                />
                <Select label="대표님 참여 방식" defaultValue="key">
                  <option value="delegate">위임형</option>
                  <option value="key">핵심 결정형</option>
                  <option value="together">공동 설계형</option>
                </Select>
              </div>
            </Card>
            <Card>
              <div className="pixel-stack">
                <h2>선택과 오류</h2>
                <Field
                  label="오류 상태 예시"
                  error="프로젝트 이름을 입력해주세요."
                  defaultValue=""
                />
                <Field
                  label="사용할 수 없는 필드"
                  disabled
                  value="API 연결 후 사용할 수 있어요"
                />
                <label className="pixel-check">
                  <input type="checkbox" defaultChecked />
                  <span>움직임 줄이기</span>
                </label>
                <fieldset className="pixel-radio-group">
                  <legend>선택 예시</legend>
                  <label className="pixel-check">
                    <input type="radio" name="visibility" defaultChecked />
                    공개
                  </label>
                  <label className="pixel-check">
                    <input type="radio" name="visibility" />
                    비공개
                  </label>
                </fieldset>
              </div>
            </Card>
          </div>
        )}
        {tab === "feedback" && (
          <div className="system-grid">
            <Card>
              <h2>중앙 업무 팝업</h2>
              <p>
                데스크톱은 중앙, 모바일은 전체 화면으로 열립니다. ESC로 닫으면
                열었던 버튼으로 초점이 돌아갑니다.
              </p>
              <Button onClick={() => setDialog(true)}>
                팝업 열기
                <PixelIcon name="chat" />
              </Button>
            </Card>
            <Card>
              <h2>작은 알림</h2>
              <p>상태를 짧게 알리고 사용자의 작업을 가리지 않습니다.</p>
              <div className="pixel-wrap">
                <Button
                  variant="secondary"
                  onClick={() =>
                    setNotification(
                      "완료 알림 예시입니다. 실제 저장은 수행하지 않았어요.",
                    )
                  }
                >
                  완료 알림 예시
                </Button>
                <Button
                  variant="danger"
                  onClick={() =>
                    setNotification(
                      "오류 알림 예시입니다. 닫기 전까지 유지됩니다.",
                    )
                  }
                >
                  오류 알림 예시
                </Button>
              </div>
            </Card>
          </div>
        )}
      </Tabs>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="함께 확인해볼까요?"
        description="중앙 팝업의 키보드와 입력 동작 예시입니다."
      >
        <div className="pixel-stack">
          <Badge>컴포넌트 예시</Badge>
          <TextArea label="의견" placeholder="생각을 남겨주세요." />
          <div className="pixel-wrap">
            <Button variant="secondary" onClick={() => setDialog(false)}>
              닫기
            </Button>
            <Button
              onClick={() => {
                setDialog(false);
                setNotification(
                  "팝업 조작을 확인했어요. 실제 승인이나 저장은 하지 않았습니다.",
                );
              }}
            >
              동작 확인
              <PixelIcon name="check" />
            </Button>
          </div>
        </div>
      </Dialog>
      <div className="pixel-toast-region" role="status" aria-live="polite">
        {notification && (
          <div className="pixel-toast">
            <PixelIcon name="bell" />
            <span>{notification}</span>
            <Button
              variant="ghost"
              aria-label="알림 닫기"
              onClick={() => setNotification(null)}
            >
              <PixelIcon name="close" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
