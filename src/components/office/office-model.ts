export type OfficePanel =
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
