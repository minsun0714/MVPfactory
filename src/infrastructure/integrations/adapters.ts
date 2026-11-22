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
  llm: { implemented: true, decided: true, decision: null }, // DEC-002: OpenAI, 모델은 LLM_MODEL
  /** 생성 코드를 설치·빌드·테스트하는 격리 환경. DEC-004 확정: 로컬 Docker(서버로 옮길 때 다시 검토) */
  sandbox: { implemented: true, decided: true, decision: null },
  /** 저장소 생성과 코드 반영 */
  github: { implemented: true, decided: true, decision: null },
  /** 배포 후보 생성과 게시 */
  vercel: { implemented: true, decided: true, decision: null },
  /** 생성 앱 DB 프로젝트 생성과 스키마 적용 */
  // DEC-005 확정: 공용 Supabase 프로젝트 1개(서울)에 앱마다 스키마. 실제 계정에서 확인 전까지 implemented=false
  supabase: { implemented: false, decided: true, decision: null },
} as const;
