"use client";
import { useState } from "react";

export type OfficePanel =
  | "projects"
  | "palette"
  | "settings"
  | "bell"
  | "pm"
  | "planner"
  | "designer"
  | "developer"
  | "meeting"
  | null;
export const team = [
  {
    id: "pm",
    name: "PM",
    title: "팀의 방향을 정리해요",
    color: "pm",
    x: 38,
    y: 33,
    description: "우선순위와 팀의 진행 상황을 한곳에 모읍니다.",
  },
  {
    id: "planner",
    name: "기획자",
    title: "아이디어를 구체적으로",
    color: "planner",
    x: 24.5,
    y: 45,
    description: "작은 아이디어를 기능과 사용자 흐름으로 정리합니다.",
  },
  {
    id: "designer",
    name: "디자이너",
    title: "쓰고 싶은 화면을 그려요",
    color: "designer",
    x: 59,
    y: 35,
    description: "사용자가 보고 누르는 모든 경험을 설계합니다.",
  },
  {
    id: "developer",
    name: "개발자",
    title: "생각을 동작으로 만들어요",
    color: "developer",
    x: 80,
    y: 58,
    description: "확정한 기획과 디자인을 동작하는 코드로 옮깁니다.",
  },
] as const;
export function useOfficePreview() {
  const [panel, setPanel] = useState<OfficePanel>(null);
  const [tab, setTab] = useState("conversation");
  const [zoom, setZoom] = useState(100);
  const [projectName, setProjectName] = useState("나의 첫 번째 프로젝트");
  const [draftName, setDraftName] = useState(projectName);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reducedMotion, setReducedMotion] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const role = team.find((member) => member.id === panel);
  function openPanel(next: OfficePanel) {
    setTab("conversation");
    setPanel(next);
  }
  function applyPreviewName() {
    if (!draftName.trim()) return;
    setProjectName(draftName.trim());
    setToast("미리보기 이름을 바꿨어요. 서버에는 저장되지 않습니다.");
    setPanel(null);
  }
  return {
    panel,
    role,
    tab,
    setTab,
    zoom,
    zoomIn: () => setZoom((value) => Math.min(125, value + 5)),
    zoomOut: () => setZoom((value) => Math.max(80, value - 5)),
    resetZoom: () => setZoom(100),
    projectName,
    draftName,
    setDraftName,
    note: role ? (notes[role.id] ?? "") : "",
    setNote: (value: string) => {
      if (role) setNotes((previous) => ({ ...previous, [role.id]: value }));
    },
    reducedMotion,
    setReducedMotion,
    toast,
    dismissToast: () => setToast(null),
    openPanel,
    closePanel: () => setPanel(null),
    applyPreviewName,
  };
}
