# 애자일 리팩토링 진행 기록 (refactor/agile-v2 → main)

일자: 2026-07-13 · 진행: 팀 에이전트 병렬(fable 모델) + 코디네이터
결과: **로컬·배포 양쪽 전 기능 검증 실패 0건**, PR #1 머지 완료 (`b0b0b27`)

## 팀 구성

| 역할 | 담당 | 산출물 |
|---|---|---|
| 민준 | 백엔드 아키텍트 | backend/src 리팩토링, 헬스 엔드포인트 |
| 수아 | 프론트엔드/UX | frontend/src 리팩토링 |
| 지훈 | DevOps | Docker Compose 배포 구성 일체 |
| 태양 | 리뷰어 | 전체 diff 리뷰 (docs/review.md) |
| 서연 | 보안 검증 | 전 기능 E2E 스크립트 (REPORT.md §16) |

각 팀원은 파일 소유 경계를 나눠 **같은 워킹트리에서 동시 병렬 작업**했다
(backend/src ↔ frontend/src ↔ 루트/배포 파일 — 겹침 0건으로 충돌 없이 완료).

---

## Sprint 0 — 베이스라인 (코디네이터)

- 브랜치 `refactor/agile-v2` 생성, 양쪽 워크스페이스 typecheck/build green 확인
- 배포 구성(Docker/compose) 부재 확인 → Sprint 1 범위에 포함
- DB(tsp-postgres :55432)·Docker 데몬 가용성 점검 → E2E는 Docker Desktop 기동 후로 계획

## Sprint 1 — 병렬 리팩토링/구축 (3명 동시)

**민준 (backend, 동작 보존)** — 커밋 `855d017`
- 5곳에 복사돼 있던 커서 페이지네이션 → `lib/pagination.ts` 통합
- `req.currentUser!` 13곳 → 타입 안전 `requireCurrentUser()` 접근자
- `resolved` 쿼리 변환을 Zod `.transform()`으로, logout promise화, 죽은 코드 4건 제거
- 제약: API 계약(경로/상태코드/메시지) 및 docs/review.md의 보안 불변식 11개 무변경

**수아 (frontend, 동작 보존)** — 커밋 `2e9014e`
- `useAsyncData`(stale 응답 경합 가드) / `useFormSubmit` / `useStartChat` 훅 추출 — 11개 페이지 보일러플레이트 ~150줄 감소
- `buildQuery`로 쿼리 조립 통일, `getErrorMessage` 헬퍼, 죽은 코드 제거
- 제약: `CSRF_INVALID` 한정 재시도, 소켓 disconnect 판별 등 계약 동작 무변경

**지훈 (배포, 신규)** — 커밋 `1179c4a`
- backend Dockerfile(multi-stage, `USER node`, entrypoint에서 `prisma migrate deploy` 재시도)
- frontend Dockerfile + nginx(단일 오리진: `/api`·`/uploads`·`/socket.io` 프록시, WebSocket 업그레이드, SPA fallback)
- docker-compose(postgres healthcheck → backend → frontend :8080), `.env.example`, `.dockerignore`
- 백엔드 수정 요청 2건을 `docs/deploy-handoff.md`로 핸드오프 (경계 준수 — 직접 수정 안 함)

**핸드오프 반영 (민준)** — 커밋 `c79709c`
- B-1: `/health`를 rate-limiter·세션 미들웨어 앞으로 이동
- B-2: `GET /health/ready` 신설 (`SELECT 1` — 200 ready / 503 unavailable) → compose healthcheck가 이 경로 사용

## Sprint 2 — 리뷰 (태양)

- 검토: diff 전후 문자 단위 대조 + 보안 파일 무변경(`git diff` 공집합) 확인 + Dockerfile deps 스테이지 스크래치 시뮬레이션
- 결과: **Critical 0 / Medium 0 / Low 5** — 병합 블로커 없음
- Low 5건 반영(코디네이터): 상세/프로필 페이지 비-404 에러 폴백(R-1), readiness 실패 로그(R-2), 문서 경로 정정(R-3), nginx `/assets/` nosniff(R-4), `.env.example` 비밀번호 URL 예약문자 주의(R-5)
- 단서: "배포 구성은 실빌드 0회 — 런타임 검증 전까지 검증 완료로 취급하지 말 것" → Sprint 3에서 적중

## Sprint 3 — 실전 검증 (서연 + 지훈 + 코디네이터)

**발견·수정된 실전 버그 1건** (상세: `docs/deploy-handoff.md` §1-bis)
- 증상: backend 컨테이너가 `migrate deploy`에서 권한 에러로 재시작 루프
- 원인: 스테이지 간 openssl 유무 차이로 prisma 엔진이 `debian-openssl-1.1.x` 변형으로 들어감 → 런타임(openssl 3)이 3.0.x 엔진을 찾다 네트워크 다운로드 시도 → `USER node` 쓰기 거부
- 수정(지훈): 전 스테이지 공유 `base`(openssl 통일) + 엔진 부재 시 **이미지 빌드 자체가 실패하는 가드** + `--chown=node:node`

**검증 매트릭스** (전부 실측)

| 환경 | 스위트 | 결과 |
|---|---|---|
| 로컬 dev (:4000) | verifyFullE2E.js | 44/44 |
| 로컬 dev | verifyWalletAdminEdgeCases.js (관리자 대조군 포함) | 20/20 |
| 배포 스택 (nginx :8080 경유) | verifyFullE2E.js | 42/42 (+헬스 2건 컨테이너 내부 확인) |
| 배포 스택 | verifyWalletAdminEdgeCases.js (psql 승격 대조군 포함) | 20/20 |
| 배포 스택 | 22개 커서 체인 순회 (limit=5, 중복/누락/비종결 검사) | PASS |
| 배포 스택 | postgres 중단 → `/health/ready` 503 → 복구 200 | PASS |
| 배포 스택 | 업로드 볼륨 영속(재시작 후 200), 세션 유지, migrate 멱등 | PASS |
| 배포 스택 | WebSocket 101, 신고 임계치 도달 시 살아있는 소켓 강제 차단(구 C-1), XFF rate-limit 429, CSRF 403+`CSRF_INVALID` | PASS |

검증 중 판별한 **비회귀(환경) 이슈**: authLimiter(실패 5회/15분/IP)로 인한 스위트 연속 재실행 429, `/health*`는 nginx 미프록시(내부 전용 — 의도된 설계), 신고 임계치 dev(3) vs 배포(5) 차이 → 스크립트를 `VERIFY_BASE_URL` / `VERIFY_SKIP_HEALTH` / `VERIFY_USER_REPORT_THRESHOLD`로 일반화.

## 마무리

- 스프린트 단위 5커밋 → PR #1 → main 머지 (`b0b0b27`)
- 배포 스택 볼륨 초기화 후 재기동, 정식 관리자 계정(`admin`) 생성 — 승격은 설계 원칙대로 HTTP 경로 없이 psql `UPDATE users SET role='admin'`로만 (비밀번호는 저장소에 기록하지 않음)
- 재실행 방법: README "배포 (Docker Compose)" · 검증 재실행: `backend/scripts/verifyFullE2E.js`, `npm run verify:wallet-admin --workspace backend`
