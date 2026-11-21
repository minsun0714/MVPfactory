---
title: 실제 GitHub 저장소 생성·push와 Vercel 배포 연결
reqs: [REQ-008, REQ-009]
area: integrations
owns: [src/infrastructure/github/**, src/infrastructure/vercel/**]
depends_on: []
---

## 목적

검증한 소스를 사용자의 GitHub 저장소에 커밋으로 올리고, Vercel에 배포 후보를 만들어 검증한 뒤 게시한다. 저장소·커밋·배포 버전이 서로 대응되어야 한다.

## 완료 조건

- [ ] 허용된 대상에 저장소를 만들고 실제 커밋이 존재한다. (AC-008-1, AC-008-2)
- [ ] 비밀값이 커밋에 포함되지 않는다. (AC-008-3)
- [ ] 저장소 생성이나 push가 실패하면 완료된 단계와 실패한 단계를 구분해 표시한다. (AC-008-4)
- [ ] 배포 후보를 검증한 뒤 게시하고 최종 URL에서 핵심 기능을 확인한다. (AC-009-1, AC-009-4)
- [ ] 배포 소스와 GitHub 커밋의 대응을 확인할 수 있다. (AC-009-2)

## 검증 방법

실제 GitHub·Vercel 계정으로 수행한다. 외부 작업 원장과 operationKey로 재시도 시 중복 생성이 없는지 함께 확인한다.
