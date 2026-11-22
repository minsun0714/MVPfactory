import { strict as assert } from "node:assert";
import { test } from "node:test";
import { LlmError } from "@/application/llm";
import { createOpenAiModel } from "@/infrastructure/llm/openai-model";

const KEY = "sk-test-secret-key-000000";
type Call = { url: string; init: RequestInit };

function fakeFetch(
  respond: () => Response | Promise<Response>,
  calls: Call[] = [],
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const ok = (content: string) =>
  json({
    model: "gpt-x-2026",
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
  });
const model = (fetchFn: typeof fetch, extra = {}) =>
  createOpenAiModel({ apiKey: KEY, model: "gpt-x", fetch: fetchFn, ...extra });
const kindOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof LlmError);
    return e;
  }
  throw new Error("오류가 나야 한다");
};

test("요청 형식과 응답·사용량을 변환한다", async () => {
  const calls: Call[] = [];
  const result = await model(fakeFetch(() => ok('{"a":1}'), calls)).complete({
    messages: [{ role: "user", content: "안녕" }],
    json: true,
    maxOutputTokens: 500,
  });
  assert.deepEqual(result, {
    text: '{"a":1}',
    usage: { inputTokens: 11, outputTokens: 7 },
    model: "gpt-x-2026",
  });
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${KEY}`);
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.model, "gpt-x");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.max_completion_tokens, 500);
});

test("HTTP 오류를 처리 방법별로 분류하고 키를 메시지에 넣지 않는다", async () => {
  for (const [status, kind] of [
    [401, "AUTH"],
    [403, "AUTH"],
    [429, "RATE_LIMIT"],
    [400, "INVALID"],
    [500, "PROVIDER"],
    [503, "PROVIDER"],
  ] as const) {
    const error = await kindOf(
      model(
        fakeFetch(() => json({ error: { message: "문제" } }, status)),
      ).complete({ messages: [] }),
    );
    assert.equal((error as LlmError).kind, kind, String(status));
    assert.ok(!error.message.includes(KEY));
  }
});

test("빈 응답과 거부와 길이 초과는 REFUSED로 알린다", async () => {
  for (const body of [
    { choices: [{ message: { content: "  " } }] },
    { choices: [{ message: { content: null, refusal: "안 돼요" } }] },
    { choices: [{ message: { content: "" }, finish_reason: "length" }] },
    { choices: [] },
  ])
    assert.equal(
      (
        (await kindOf(
          model(fakeFetch(() => json(body))).complete({ messages: [] }),
        )) as LlmError
      ).kind,
      "REFUSED",
    );
});

test("응답이 늦으면 TIMEOUT, 연결 실패는 PROVIDER다", async () => {
  const slow = ((_: string, init: RequestInit) =>
    new Promise((_, reject) =>
      init.signal!.addEventListener("abort", () =>
        reject(new Error("aborted")),
      ),
    )) as unknown as typeof fetch;
  const timeout = await kindOf(
    model(slow).complete({ messages: [], timeoutMs: 50 }),
  );
  assert.equal((timeout as LlmError).kind, "TIMEOUT");
  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  assert.equal(
    ((await kindOf(model(down).complete({ messages: [] }))) as LlmError).kind,
    "PROVIDER",
  );
});

test("키나 모델이 비어 있으면 만들 수 없다", () => {
  assert.throws(() => createOpenAiModel({ apiKey: " ", model: "m" }), LlmError);
  assert.throws(() => createOpenAiModel({ apiKey: "k", model: "" }), LlmError);
});
