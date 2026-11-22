"use client";
import type { ReactNode } from "react";
import type { Result } from "@/contracts";
import { apiPaths } from "@/contracts/paths";
import { useOfficeResource } from "@/hooks/useOfficeResource";
import { QueryNotice } from "@/components/office/OfficeApiPanels";
import { PixelIcon, type PixelIconName } from "@/components/ui/PixelIcon";
import { isWebUrl } from "@/components/ui/external-url";

type Tone = "success" | "danger" | "neutral" | "warning";
type Check = { label: string; value: string; tone: Tone; hint?: string };

const stepChecks = {
  PASS: { value: "통과", tone: "success" },
  FAIL: { value: "실패", tone: "danger" },
  NOT_RUN: { value: "진행 전", tone: "neutral" },
} as const;
const productChecks = {
  COMPLETE: { value: "검증 완료", tone: "success" },
  INCOMPLETE: { value: "보완 필요", tone: "danger" },
  NOT_VERIFIED: {
    value: "검증 전",
    tone: "warning",
    hint: "기능별 동작 확인은 아직 하지 않았어요.",
  },
} as const;
const databaseChecks = {
  READY: { value: "준비 완료", tone: "success" },
  NOT_NEEDED: { value: "사용 안 함", tone: "neutral" },
  FAILED: { value: "연결 실패", tone: "danger" },
  UNKNOWN: { value: "확인 필요", tone: "warning" },
} as const;
const toneIcons: Record<Tone, PixelIconName> = {
  success: "check",
  danger: "close",
  warning: "alert",
  neutral: "minus",
};

function isSafeUrl(url: string | null | undefined): url is string {
  return isWebUrl(url);
}

function ExternalButton({
  url,
  variant,
  children,
}: {
  url: string | null | undefined;
  variant: "primary" | "secondary";
  children: ReactNode;
}) {
  if (!isSafeUrl(url)) return null;
  return (
    <a
      className={`pixel-button pixel-button--${variant} result-link`}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      {children}
      <PixelIcon name="arrow" width="18" height="18" />
      <span className="sr-only">(새 창)</span>
    </a>
  );
}

export function ExecutionResult({
  id,
  revision,
  embedded = false,
}: {
  id: string;
  revision?: number;
  embedded?: boolean;
}) {
  const query = useOfficeResource<Result>(apiPaths.projectResult(id), revision);
  const result = query.data;
  const checks: Check[] = result
    ? [
        { label: "빌드", ...stepChecks[result.completion.build] },
        { label: "배포", ...stepChecks[result.completion.deployment] },
        { label: "제품 검증", ...productChecks[result.completion.product] },
        ...(result.database
          ? [
              {
                label: "데이터베이스",
                ...databaseChecks[result.database.status],
              },
            ]
          : []),
      ]
    : [];
  return (
    <section
      className={`result-card${embedded ? " result-card--embedded" : ""}`}
      aria-labelledby="result-title"
    >
      <div className="result-heading">
        <h2 id="result-title">{embedded ? "배포 결과" : "프로젝트 결과"}</h2>
        {result && (
          <p className="pixel-muted">
            {result.completion.isDemo
              ? "과거 데모 기록이에요. 실제 앱이나 배포가 만들어진 결과는 아니에요."
              : result.app
                ? "배포된 앱을 열어 직접 확인해 보세요."
                : "실행이 진행되면 결과가 이곳에 모여요."}
          </p>
        )}
      </div>
      <QueryNotice {...query} retry={query.reload} />
      {result && (
        <>
          {(isSafeUrl(result.app?.url) ||
            isSafeUrl(result.repository?.url) ||
            isSafeUrl(result.deployment?.url)) && (
            <div className="result-links">
              <ExternalButton url={result.app?.url} variant="primary">
                앱 열기
              </ExternalButton>
              <ExternalButton url={result.repository?.url} variant="secondary">
                소스 코드
              </ExternalButton>
              <ExternalButton url={result.deployment?.url} variant="secondary">
                배포 상세
              </ExternalButton>
            </div>
          )}
          {!result.completion.isDemo && (
            <dl className="result-checks">
              {checks.map((check) => (
                <div
                  key={check.label}
                  className="result-check"
                  data-tone={check.tone}
                >
                  <dt>{check.label}</dt>
                  <dd>
                    <PixelIcon
                      name={toneIcons[check.tone]}
                      width="16"
                      height="16"
                    />
                    {check.value}
                  </dd>
                  {check.hint && <dd className="result-hint">{check.hint}</dd>}
                </div>
              ))}
            </dl>
          )}
          {!result.completion.isDemo &&
            result.remainingConstraints.length > 0 && (
              <div className="result-constraints">
                <h3>남은 확인 사항</h3>
                <ul>
                  {result.remainingConstraints.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          {result.lastGood && (
            <p className="result-last-good">
              <span>마지막 정상 배포</span>
              <time dateTime={result.lastGood.at}>
                {new Date(result.lastGood.at).toLocaleString("ko-KR", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
              <span aria-hidden="true">·</span>
              <span>
                커밋{" "}
                <code title={result.lastGood.commitSha}>
                  {result.lastGood.commitSha.slice(0, 7)}
                </code>
              </span>
            </p>
          )}
        </>
      )}
    </section>
  );
}
