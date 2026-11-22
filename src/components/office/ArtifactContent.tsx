import { ARTIFACT_LIST_SEPARATOR, ARTIFACT_STRUCTURE_KEY } from "@/contracts";
import { PixelIcon } from "@/components/ui/PixelIcon";
import { isWebUrl } from "@/components/ui/external-url";

type PlanField = { name: string; type: string; required: boolean };
type PlanTable = {
  name: string;
  fields: PlanField[];
  access: Record<string, boolean>;
};

const accessLabels: [key: string, label: string][] = [
  ["read", "조회"],
  ["insert", "추가"],
  ["update", "수정"],
  ["delete", "삭제"],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 산출물 본문은 모델 출력에서 온 값이므로 형식을 확인한 뒤에만 표로 그린다. */
function parseDataPlan(value: unknown): PlanTable[] | null {
  if (typeof value !== "string" || !value.trimStart().startsWith("{"))
    return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.tables)) return null;
  const tables: PlanTable[] = [];
  for (const table of parsed.tables) {
    if (!isRecord(table) || typeof table.name !== "string") return null;
    if (!Array.isArray(table.fields) || !isRecord(table.access)) return null;
    const fields: PlanField[] = [];
    for (const field of table.fields) {
      if (!isRecord(field) || typeof field.name !== "string") return null;
      fields.push({
        name: field.name,
        type: typeof field.type === "string" ? field.type : "-",
        required: field.required === true,
      });
    }
    const access: Record<string, boolean> = {};
    for (const [key, allowed] of Object.entries(table.access))
      access[key] = allowed === true;
    tables.push({ name: table.name, fields, access });
  }
  return tables;
}

function DataPlanView({ tables }: { tables: PlanTable[] }) {
  return (
    <div className="artifact-plan">
      {tables.map((table) => (
        <div key={table.name} className="artifact-plan-table">
          <p className="artifact-plan-name">
            <PixelIcon name="grid" width="16" height="16" />
            <code>{table.name}</code>
          </p>
          <div className="artifact-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">필드</th>
                  <th scope="col">형식</th>
                  <th scope="col">필수</th>
                </tr>
              </thead>
              <tbody>
                {table.fields.map((field) => (
                  <tr key={field.name}>
                    <td>
                      <code>{field.name}</code>
                    </td>
                    <td>{field.type}</td>
                    <td>{field.required ? "필수" : "선택"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="artifact-access">
            <span>로그인 없이 허용</span>
            <ul>
              {accessLabels.map(([key, label]) => (
                <li key={key} data-allowed={table.access[key] === true}>
                  <PixelIcon
                    name={table.access[key] ? "check" : "close"}
                    width="14"
                    height="14"
                  />
                  {label}
                  <span className="sr-only">
                    {table.access[key] ? " 허용" : " 허용 안 함"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}

function ArtifactValue({ value }: { value: unknown }) {
  const plan = parseDataPlan(value);
  if (plan) return <DataPlanView tables={plan} />;
  if (typeof value === "string") {
    if (isWebUrl(value.trim()))
      return (
        <p>
          <a
            className="artifact-external-link"
            href={value.trim()}
            target="_blank"
            rel="noopener noreferrer"
          >
            {value.trim()} <PixelIcon name="arrow" width="16" height="16" />
            <span className="sr-only">(새 창)</span>
          </a>
        </p>
      );
    const items = value
      .split(ARTIFACT_LIST_SEPARATOR)
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length > 1)
      return (
        <ul className="artifact-list">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    return <p>{value}</p>;
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "string"))
    return (
      <ul className="artifact-list">
        {value.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  if (typeof value === "number" || typeof value === "boolean")
    return <p>{String(value)}</p>;
  return (
    <pre className="office-artifact">{JSON.stringify(value, null, 2)}</pre>
  );
}

// jsonb 저장으로 키 순서가 바뀌므로, 알려진 키는 읽는 순서대로 먼저 보여 준다.
const preferredOrder = [
  "목적",
  "범위 요약",
  "핵심 사용자",
  "포함 범위",
  "제외 범위",
  "핵심 기능",
  "사용자 흐름",
  "완료 조건",
  "대상과 상황",
  "화면 모드",
  "핵심 과업",
  "디자인 방향",
  "레이아웃·상호작용",
  "피할 것",
  "가정",
  "화면",
  "화면별 기능",
  "화면별 주 행동",
  "사용자 행동",
  "상태",
  "연결",
  "디자인 지침",
  "제외할 것",
  "범위 검토",
  "데이터",
  "데이터 저장",
  "공개 범위",
  "데이터 계획",
];
function orderedEntries(content: Record<string, unknown>) {
  const rank = (key: string) => {
    const i = preferredOrder.indexOf(key);
    return i === -1 ? preferredOrder.length : i;
  };
  // 구조 JSON은 문장 항목과 같은 내용이므로 원본 보기에서만 보여 준다.
  return Object.entries(content)
    .filter(([key]) => key !== ARTIFACT_STRUCTURE_KEY)
    .sort(([a], [b]) => rank(a) - rank(b));
}

/** 산출물 본문(키 → 값)을 읽기 쉬운 문서 형태로 보여 준다. 원본은 접어서 제공한다. */
export function ArtifactContent({
  content,
}: {
  content: Record<string, unknown> | null;
}) {
  if (!content || Object.keys(content).length === 0)
    return <p className="pixel-muted">본문이 없는 산출물입니다.</p>;
  return (
    <div className="artifact-doc">
      <dl>
        {orderedEntries(content).map(([key, value]) => (
          <div key={key} className="artifact-section">
            <dt>{key}</dt>
            <dd>
              <ArtifactValue value={value} />
            </dd>
          </div>
        ))}
      </dl>
      <details className="artifact-raw">
        <summary>원본 JSON 보기</summary>
        <pre className="office-artifact">
          {JSON.stringify(content, null, 2)}
        </pre>
      </details>
    </div>
  );
}
