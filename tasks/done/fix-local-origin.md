---
title: Next.js 내부 URL 차이로 정상 요청이 차단되는 문제 수정
reqs: [REQ-001]
area: api
owns: [src/server/http.ts, tests/http-origin.test.ts]
depends_on: []
---

## 목적

같은 로컬 출처의 변경 요청이 FORBIDDEN_ORIGIN으로 거절되는 문제를 해결한다.

## 완료 조건

- [x] 실제 Host가 일치하면 내부 URL 호스트와 달라도 허용한다.
- [x] 외부 출처·다른 포트·프로토콜·잘못된 출처는 거부한다.
- [x] 신뢰하지 않는 전달 헤더로 검사를 우회할 수 없다.

## 검증

출처 단위 테스트 4개 통과. 실제 브라우저 scope-check 수정 전 403, 수정 후 200. 외부 Origin 403 유지. DB 쓰기 없음.
