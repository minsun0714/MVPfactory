"use client";
import type { Result } from "@/contracts";
import { apiPaths } from "@/contracts/paths";
import { useOfficeResource } from "@/hooks/useOfficeResource";
import { QueryNotice } from "@/components/office/OfficeApiPanels";
import { SafeLink } from "@/components/office/ProjectOperations";
const stepLabels = {
  PASS: "통과",
  FAIL: "실패",
  NOT_RUN: "아직 진행하지 않음",
};
const productLabels = {
  COMPLETE: "검증 완료",
  INCOMPLETE: "보완 필요",
  NOT_VERIFIED: "검증 전",
};
export function ExecutionResult({
  id,
  revision,
}: {
  id: string;
  revision?: number;
}) {
  const query = useOfficeResource<Result>(apiPaths.projectResult(id), revision);
  const result = query.data;
  return (
    <section className="execution-result" aria-label="프로젝트 결과">
      <h2>프로젝트 결과</h2>
      <QueryNotice {...query} retry={query.reload} />
      {result && (
        <>
          <p className="pixel-muted">
            {result.completion.isDemo
              ? "과거 데모 기록이에요. 실제 앱이나 배포가 만들어진 결과는 아니에요."
              : result.app
                ? "앱과 검증 결과를 확인하세요."
                : "실행이 진행되면 결과가 이곳에 모여요."}
          </p>
          {!result.completion.isDemo && (
            <dl className="execution-checks">
              <div>
                <dt>빌드</dt>
                <dd>{stepLabels[result.completion.build]}</dd>
              </div>
              <div>
                <dt>배포</dt>
                <dd>{stepLabels[result.completion.deployment]}</dd>
              </div>
              <div>
                <dt>제품 검증</dt>
                <dd>{productLabels[result.completion.product]}</dd>
              </div>
            </dl>
          )}
          <div className="pixel-wrap">
            <SafeLink url={result.app?.url}>앱 열기</SafeLink>
            <SafeLink url={result.repository?.url}>소스 코드 보기</SafeLink>
            <SafeLink url={result.deployment?.url}>배포 보기</SafeLink>
          </div>
          {!result.completion.isDemo && result.database && (
            <p>
              데이터베이스:{" "}
              {
                {
                  READY: "준비 완료",
                  NOT_NEEDED: "사용하지 않음",
                  FAILED: "연결 실패",
                  UNKNOWN: "확인 필요",
                }[result.database.status]
              }
            </p>
          )}
          {!result.completion.isDemo &&
            result.remainingConstraints.length > 0 && (
              <div className="pixel-stack">
                <h3>남은 확인 사항</h3>
                <ul>
                  {result.remainingConstraints.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          {result.lastGood && (
            <div className="pixel-stack">
              <h3>마지막 정상 배포</h3>
              <p>{new Date(result.lastGood.at).toLocaleString("ko-KR")}</p>
              <code>{result.lastGood.commitSha}</code>
            </div>
          )}
        </>
      )}
    </section>
  );
}
