/**
 * 유스케이스가 의존하는 저장·외부 연동 계약(Port). 구현은 `src/infrastructure`에 있다.
 * 반환 타입은 API 계약(`src/contracts`)이며 Prisma 타입을 노출하지 않는다.
 */
import type {
  Artifact,
  ArtifactSummary,
  CharacterAppearance,
  Company,
  Connection,
  CreateProjectRequest,
  Decision,
  DecisionResponseRequest,
  DecisionSummary,
  Health,
  Meeting,
  MeetingSummary,
  OfficeLayout,
  OfficeState,
  Page,
  Project,
  ProjectSummary,
  Provider,
  Result,
  RoleId,
  Run,
  RunEvent,
  Settings,
  StartRunRequest,
  UpdateSettingsRequest,
  VerificationReport,
  WorkspaceEvent,
} from "@/contracts";
import type { PageParams } from "@/domain/validation";
import type { DecisionStatus } from "@/contracts/decisions";

export type IdempotentInput<T> = { key: string; request: T };

export interface ProjectRepository {
  create(input: IdempotentInput<CreateProjectRequest>): Promise<Project>;
  list(
    query: PageParams & { archived: boolean },
  ): Promise<Page<ProjectSummary>>;
  find(id: string): Promise<Project | null>;
  setArchived(id: string, archived: boolean): Promise<void>;
}

export interface RunRepository {
  /** Run 접수. 이 하나의 저장 단위 안에서 Run·Job·예약·이벤트가 함께 만들어진다. */
  start(
    projectId: string,
    input: IdempotentInput<StartRunRequest>,
  ): Promise<Run>;
  find(id: string): Promise<Run | null>;
  listByProject(
    projectId: string,
    query: PageParams,
  ): Promise<Page<Run> | null>;
  /** 일시정지 요청. 진행 중이면 요청만 저장하고, 아니면 바로 정지한다. */
  pause(id: string): Promise<Run>;
  /** 정지된 Run을 해소되지 않은 조건에 맞는 상태로 되돌린다. */
  resume(id: string): Promise<Run>;
  /** 실패한 Run을 같은 runId로 다시 시도한다. */
  retry(id: string): Promise<Run>;
  /** Run이 없으면 null */
  listArtifacts(runId: string): Promise<ArtifactSummary[] | null>;
  findArtifact(id: string): Promise<Artifact | null>;
}

export interface DecisionRepository {
  list(
    query: PageParams & { status?: DecisionStatus; projectId?: string },
  ): Promise<Page<DecisionSummary>>;
  find(id: string): Promise<Decision | null>;
  /** 응답 저장. 응답·Run 재개·Job 등록·이벤트가 함께 처리된다. */
  respond(id: string, request: DecisionResponseRequest): Promise<Decision>;
}

export type EventWindow = { lastSequence: number; retainedFrom: number };

export interface RunEventRepository {
  /** Run이 없으면 null */
  window(runId: string): Promise<EventWindow | null>;
  listAfter(runId: string, after: number, limit: number): Promise<RunEvent[]>;
}

/** 새 이벤트가 저장됐다는 신호를 받는다. 신호는 놓칠 수 있으므로 DB가 기준이다. */
export interface RunEventSource {
  /** `"*"`는 연결이 끊겼다 복구되어 모든 Run을 다시 확인해야 한다는 뜻 */
  subscribe(listener: (runId: string | "*") => void): () => void;
}

export interface IntegrationReadiness {
  /** 실제(REAL) 실행에 필요한 연동이 모두 준비되었는지 */
  isRealModeAvailable(): Promise<boolean>;
  /**
   * 준비 여부와 정확한 이유. 구현하지 않으면 `isRealModeAvailable`의 결과에
   * 일반 문구를 붙여 쓴다(테스트 대역과의 호환).
   */
  assess?(): Promise<{ available: boolean; reason: string | null }>;
}

export interface OfficeRepository {
  /** 프로젝트가 없으면 null */
  officeState(projectId: string): Promise<OfficeState | null>;
  /** Run이 없으면 null */
  meetings(runId: string): Promise<MeetingSummary[] | null>;
  meeting(id: string): Promise<Meeting | null>;
}

export interface CompanyRepository {
  get(): Promise<Company>;
  /** 저장된 버전이 `version`과 다르면 `VERSION_CONFLICT`를 던진다. */
  updateCharacter(
    role: RoleId,
    version: number,
    appearance: CharacterAppearance,
  ): Promise<Company>;
  updateOffice(version: number, layout: OfficeLayout): Promise<Company>;
}

export interface SettingsRepository {
  get(): Promise<Settings>;
  update(input: UpdateSettingsRequest): Promise<Settings>;
  saveConnection(connection: Connection): Promise<Connection>;
}

/** 공급자에 실제로 권한을 확인한다. 비밀 키는 이 구현 안에서만 다룬다. */
export interface ConnectionProbe {
  check(provider: Provider): Promise<Connection>;
}

export interface HealthRepository {
  check(): Promise<Health>;
}

export interface ResultRepository {
  /** 프로젝트가 없으면 null */
  result(projectId: string): Promise<Result | null>;
  /** 검증 결과가 아직 없으면 null */
  verification(runId: string): Promise<VerificationReport | null>;
  runExists(runId: string): Promise<boolean>;
}

/** 작업 공간 스트림이 쓰는 조회 */
export interface WorkspaceFeedRepository {
  /** 접속 시점의 Run별 마지막 이벤트 순번. 이 이전 이벤트는 다시 보내지 않는다. */
  snapshotCursors(): Promise<Map<string, number>>;
  /** Run의 새 이벤트 중 작업 공간 이벤트로 바꿀 수 있는 것 */
  changesAfter(
    runId: string,
    after: number,
  ): Promise<{ events: WorkspaceEvent[]; lastSequence: number }>;
}
