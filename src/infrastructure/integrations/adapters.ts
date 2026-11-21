/**
 * 실제 실행에 필요한 어댑터와 결정의 **현재 사실**. 준비 상태 판단의 근거이므로 거짓으로 켜지 않는다.
 *
 * - `implemented`는 그 어댑터가 실제로 일을 하는 코드(생성·반영·배포 등)가 저장소에 있고
 *   테스트되었을 때만 true다. 연결 확인(읽기 전용)은 어댑터 구현이 아니다.
 * - `decided`는 docs에 확정된 결정이 있을 때만 true다.
 *
 * 어댑터를 구현하거나 결정이 확정되면 이 값을 바꾸고 `tests/readiness.test.ts`를 함께 갱신한다.
 */
export const ADAPTERS = {
  /** 역할별 LLM 호출 클라이언트 */
  llm: {
    implemented: false,
    decided: false,
    decision:
      "DEC-002 AI 연결 방식(API 직접 호출 또는 기존 코딩 도구 연계)과 모델·비용 부담",
  },
  /** 생성 코드를 설치·빌드·테스트하는 격리 환경 */
  sandbox: {
    implemented: false,
    decided: false,
    decision: "DEC-004 생성 코드 실행 환경과 권한",
  },
  /** 저장소 생성과 코드 반영 */
  github: { implemented: false, decided: true, decision: null },
  /** 배포 후보 생성과 게시 */
  vercel: { implemented: false, decided: true, decision: null },
  /** 생성 앱 DB 프로젝트 생성과 스키마 적용 */
  supabase: {
    implemented: false,
    decided: false,
    decision: "DEC-005 Supabase 조직·지역·요금제·생성 한도",
  },
} as const;
