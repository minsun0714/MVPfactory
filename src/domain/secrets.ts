/**
 * 팩토리의 비밀값(공급자 토큰, DB 비밀번호)이 로그·오류 메시지·생성 앱 소스로 새지 않게 하는 규칙.
 * 순수 함수이며 비밀값을 저장하거나 출력하지 않는다.
 */

const MASK = "[비밀값]";
/** 너무 짧은 값은 일반 단어와 겹쳐 오탐이 나므로 비밀값으로 다루지 않는다. */
const MIN_SECRET_LENGTH = 8;

/** 알려진 토큰 형식. 값이 환경변수에 없어도 소스에 들어가면 잡는다. */
const TOKEN_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "GitHub 토큰", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "GitHub 세분화 토큰", pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: "API 키(sk-)", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "Supabase 토큰", pattern: /\bsbp_[A-Za-z0-9]{30,}\b/ },
  { name: "개인 키", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function usable(secrets: (string | undefined | null)[]): string[] {
  return (
    [
      ...new Set(
        secrets.filter(
          (s): s is string => !!s && s.length >= MIN_SECRET_LENGTH,
        ),
      ),
    ]
      // 긴 값부터 바꿔야 짧은 값이 긴 값의 일부일 때 일부만 남지 않는다.
      .sort((a, b) => b.length - a.length)
  );
}

/** 문자열에서 알려진 비밀값과 토큰 형식을 가린다. 로그와 오류 메시지를 남기기 전에 쓴다. */
export function createRedactor(
  secrets: (string | undefined | null)[],
): (text: string) => string {
  const values = usable(secrets);
  const exact =
    values.length > 0 ? new RegExp(values.map(escape).join("|"), "g") : null;
  return (text) => {
    let result = exact ? text.replace(exact, MASK) : text;
    for (const { pattern } of TOKEN_PATTERNS)
      result = result.replace(
        new RegExp(pattern.source, `${pattern.flags}g`),
        MASK,
      );
    return result;
  };
}

export type SourceFile = { path: string; content: string };
export type SecretLeak = { path: string; kind: string };

/**
 * 생성 앱의 소스 파일에 비밀값이 들어 있는지 검사한다. 저장소에 반영하기 전에 반드시 실행한다.
 * 어느 파일에 어떤 종류가 있는지만 알려 주고, 값 자체는 결과에 담지 않는다.
 */
export function findSecretLeaks(
  files: SourceFile[],
  secrets: (string | undefined | null)[],
): SecretLeak[] {
  const values = usable(secrets);
  const leaks: SecretLeak[] = [];
  for (const file of files) {
    if (values.some((value) => file.content.includes(value)))
      leaks.push({ path: file.path, kind: "팩토리 비밀값" });
    for (const { name, pattern } of TOKEN_PATTERNS)
      if (pattern.test(file.content))
        leaks.push({ path: file.path, kind: name });
  }
  return leaks;
}

/** 비밀값이 들어 있는 환경 파일은 저장소에 올리지 않는다. 예시 파일(`.env.example`)은 허용한다. */
export function isForbiddenSourcePath(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  return /^\.env(\..+)?$/.test(name) && name !== ".env.example";
}
