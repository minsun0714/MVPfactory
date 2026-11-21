---
title: 한 줄로 쓴 작업 이름
reqs: [REQ-000] # 관련 PRD 요구사항. 하나 이상 필요
area: db # db, api, ui, workflow, integrations, docs 등 하나만
owns: [src/lib/example.ts] # 이 작업이 고치는 파일·폴더. 폴더는 src/foo/** 형식
depends_on: [] # 먼저 끝나야 하는 작업의 파일 이름(확장자 제외)
---

## 목적

무엇이 왜 필요한지 2~3문장으로 쓴다.

## 완료 조건

- [ ] 관련 AC 번호와 함께 확인할 수 있는 조건을 쓴다.

## 검증 방법

어떤 명령이나 시나리오로 확인하는지 쓴다. 모의 연동으로 확인한 것과 실제 연동으로 확인한 것을 구분한다.
