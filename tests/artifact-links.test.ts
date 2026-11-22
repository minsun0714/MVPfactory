import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactContent } from "@/components/office/ArtifactContent";
import { isWebUrl } from "@/components/ui/external-url";

test("산출물의 웹 주소는 새 창 링크이고 실행 가능한 문자열은 텍스트다", () => {
  const html = renderToStaticMarkup(
    createElement(ArtifactContent, {
      content: {
        저장소: "https://github.com/minsun0714/mvp-app-4gh9a462",
        "운영 주소": "https://mvp-app-4gh9a462.vercel.app/",
        오류: "javascript:alert(1)",
        설명: "<script>alert(1)</script>",
      },
    }),
  );
  assert.equal((html.match(/target="_blank"/g) ?? []).length, 2);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /href="javascript:|<script>/);
});

test("링크는 정상 HTTP(S) 주소만 허용한다", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,test",
    "//evil.test",
    "https://",
    "https://user:pass@example.com",
    null,
  ]) {
    assert.equal(isWebUrl(value), false);
  }
  assert.equal(isWebUrl("https://mvp-app-4gh9a462.vercel.app/"), true);
});
