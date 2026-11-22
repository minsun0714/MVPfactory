/** 산출물 등 외부 입력을 링크로 표시할 때 웹 주소만 허용한다. */
export function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}
