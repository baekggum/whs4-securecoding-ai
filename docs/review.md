# 코드 리뷰 리포트

작성자: 태양 (리뷰어)
검토 대상: `master` 브랜치 커밋 `b9c190c` ("Implement MVP: session-based auth, product/report/chat backend, React frontend")
검토 범위: 전체 MVP(백엔드+프론트엔드) 중 세션 관리, CSRF, IDOR, 신고 임계치 트랜잭션을 중점 검토

이 문서는 `docs/architecture.md`(민준), `docs/research.md`(지훈), `docs/design.md`(수아)의 설계 의도와
`REPORT.md`(서연)에 기술된 보안 구현·검증 내역을 실제 코드와 대조하여 확인한 결과입니다.
"문제 → 재현 시나리오 → 권장 수정 방향" 형식으로 정리합니다.

> **재검토 업데이트 (커밋 `62087be`)**: 아래 원본 리뷰(C-1, M-1, L-1~L-3) 전 항목이 반영되어 재검토를
> 완료했습니다. 결과는 문서 맨 아래 [재검토 결과](#재검토-결과-커밋-62087be) 섹션 참고. 모든 항목 **해결 확인**.

---

## 요약

| 심각도 | 개수 |
|---|---|
| Critical | 1 |
| Medium | 1 |
| Low / Nit | 3 |

세션 고정 방지, CSRF 더블서브밋+HMAC, IDOR 소유권 검증, 신고 카운트 증가의 트랜잭션/row-lock 처리는
설계 문서 및 `REPORT.md`의 주장과 실제 코드가 일치하며 견고합니다. 다만 **Socket.IO 경로에서
"신고 누적 시 즉시 무효화" 보장이 REST와 동일하게 지켜지지 않는 점**이 이번 검토의 핵심 발견입니다.

---

## 🔴 Critical

### C-1. Socket.IO 연결은 신고 임계치 도달로 인한 `dormant` 전환 후에도 즉시 차단되지 않음

- **파일**: `backend/src/socket/index.ts:31-47` (핸드셰이크 인증), `:54-89` (`join_room`/`send_message` 핸들러)
- **연관 파일**: `backend/src/middleware/auth.ts:8-25` (REST 측 비교 대상), `backend/src/services/report.service.ts:12-62` (신고 임계치 트랜잭션), `backend/src/services/chat.service.ts:85-128` (`assertRoomAccess`, `saveMessage`)

**문제 설명**:
`REPORT.md` §5는 다음과 같이 명시합니다.

> "즉시 무효화: 매 요청마다 `attachCurrentUser` 미들웨어가 DB에서 최신 유저 status를 조회. `dormant`이거나
> 삭제된 유저면 세션을 즉시 파기하고 401 반환 — 신고 누적으로 휴면 처리된 직후의 요청부터 바로 차단됨."

이 보장은 **REST 경로에만** 실제로 적용됩니다. `attachCurrentUser`(`middleware/auth.ts`)는 매 HTTP 요청마다
DB에서 `user.status`를 재조회하지만, Socket.IO는 `io.use(...)` 핸들러(`socket/index.ts:31-47`)에서
**연결(handshake) 시점에 단 한 번만** `user.status === "active"`를 확인하고 그 결과를 `socket.data.user`에
캐시합니다. 이후 `join_room`(`:54-65`), `send_message`(`:67-89`) 핸들러는 `chat.service.ts`의
`assertRoomAccess`/`saveMessage`만 호출하며, 이 함수들은 **방 접근 권한(참여자 여부)만 검증할 뿐 호출자의
현재 계정 상태는 재조회하지 않습니다** (`chat.service.ts:85-103`, `:121-128`).

**재현 시나리오**:
1. 유저 A가 브라우저에서 채팅 화면을 열어 Socket.IO 연결을 맺는다 (`socket.data.user.status = "active"`로 캐시됨).
2. 다른 유저들이 A를 신고하여 `report_count`가 `USER_REPORT_THRESHOLD`(기본 5)에 도달, `report.service.ts:51-52`에서
   A의 `status`가 `dormant`로 전환된다.
3. A가 REST API(`GET /api/users/me` 등)를 호출하면 `attachCurrentUser`가 즉시 401을 반환하고 세션을 파기한다 — 여기까지는 문서 주장과 일치.
4. 그러나 A가 채팅 탭을 새로고침하지 않고 그대로 두면, 이미 맺어진 Socket.IO 연결은 끊어지지 않는다.
   A는 `send_message` 이벤트를 계속 보낼 수 있고, `saveMessage(roomId, A.id, content)`가 상태 재검증 없이
   메시지를 정상 저장·브로드캐스트한다. 즉 **휴면 처리된 계정이 무기한 채팅을 계속할 수 있다.**
5. 부수 효과: 브로드캐스트되는 `senderStatus`(`socket/index.ts:79`)도 handshake 시점에 캐시된 값이므로,
   다른 유저들에게는 A가 계속 `"active"`로 표시된다.

**권장 수정 방향**:
- (권장) `report.service.ts`의 신고 트랜잭션에서 유저가 `dormant`로 전환되는 순간, 서버가 보유한
  유저ID→소켓 매핑을 통해 해당 유저의 모든 소켓을 `disconnect()`시킨다 (Socket.IO 룸 기능을 활용해
  유저별 room에 join시켜두면 targeting이 쉬움).
- (대안, 더 간단하지만 비용 있음) `join_room`/`send_message` 핸들러에서도 REST와 동일하게 매 이벤트마다
  DB에서 최신 `status`를 재조회해 `dormant`면 거부 + 소켓 연결 종료.
- 어느 방식이든 채택 후 `REPORT.md` §5의 "즉시 무효화" 검증 항목에 Socket.IO 경로에 대한 실측 검증을 추가해야 함.

---

## 🟡 Medium

### M-1. `startDirectRoom`의 TOCTOU 레이스로 동시 요청 시 처리되지 않은 500 에러

- **파일**: `backend/src/services/chat.service.ts:27-56`
- **연관 스키마**: `backend/prisma/schema.prisma:79-91` (`ChatRoom` 모델의 `@@unique([userIdLow, userIdHigh])`)

**문제 설명**:
`startDirectRoom`은 기존 1:1 채팅방을 `findUnique`로 조회한 뒤, 없으면 트랜잭션 내에서 `create`합니다. 조회와
생성 사이에 원자성이 없어, 동일한 두 유저 쌍에 대해 "채팅 시작" 요청이 동시에 들어오면 둘 다 "기존 방 없음"으로
판단하고 각자 `create`를 시도합니다. 두 번째 생성은 `(userIdLow, userIdHigh)` unique 제약 위반(P2002)으로
실패하는데, 이 에러를 잡아주는 코드가 없어 그대로 `errorHandler`의 catch-all(500, "서버 오류가 발생했습니다.")로
떨어집니다.

참고로 `report.service.ts`(`:34-61`)는 정확히 이런 유형의 레이스를 의식해 row-lock 기반 트랜잭션과
`P2002` 캐치(`:56-60`)로 안전하게 처리하고 있어, 동일한 패턴을 채팅방 생성에도 적용하지 않은 점이 눈에 띕니다.

**재현 시나리오**:
1. 유저 A와 B가 서로에 대해 "채팅 시작하기" 버튼을 동시에 클릭(또는 A가 더블클릭)한다.
2. 두 요청이 거의 동시에 `startDirectRoom(A, B)` / `startDirectRoom(B, A)`(내부적으로 동일 pair로 정규화됨)를 호출한다.
3. 둘 다 `existing` 조회에서 `null`을 받고 `create`를 시도, 하나는 성공하고 다른 하나는 P2002로 실패해 500 응답을 받는다.

**보안 영향**: 없음 (가용성/UX 문제). 다만 사용자 입장에서는 "채팅 시작" 버튼을 누른 순간 이유 없는 서버 오류를 보게 됨.

**권장 수정 방향**: `tx.chatRoom.create` 호출부를 `try/catch`로 감싸 `P2002` 발생 시 방금 실패한 트랜잭션 대신
`findUnique`로 기존 방을 재조회해 반환하도록 처리(report.service.ts의 패턴과 동일한 방식).

---

## 🟢 Low / Nit

### L-1. 로그아웃 시 CSRF 쿠키(`tsp.csrf`)가 삭제되지 않음

- **파일**: `backend/src/routes/auth.routes.ts:49-62`

`logout` 핸들러는 `req.session.destroy()` 후 `res.clearCookie(env.SESSION_COOKIE_NAME, ...)`만 호출하고,
`middleware/csrf.ts`가 발급한 `tsp.csrf` 쿠키는 그대로 남습니다. CSRF 토큰 자체는 인증 정보가 아니므로
단독으로는 취약점이 아니지만, 공유 PC에서 로그아웃 후에도 이전 세션에서 발급된 CSRF 토큰이 브라우저에 남아있는 것은
"로그아웃 시 관련 상태를 모두 정리한다"는 원칙에 부합하지 않습니다.

**권장 수정 방향**: 로그아웃 응답에서 `res.clearCookie(CSRF_COOKIE_NAME, { path: "/" })`도 함께 호출.

### L-2. 프론트엔드가 모든 403을 CSRF 실패로 간주하고 재시도

- **파일**: `frontend/src/api/client.ts:64-69`

`request()`는 안전하지 않은 메서드(POST/PATCH/DELETE)에서 403을 받으면 무조건 CSRF 토큰을 재발급받아
1회 재요청합니다. 하지만 403은 CSRF 실패(`middleware/csrf.ts:57`) 외에도 상품 소유권 위반
(`product.service.ts:76-78`, "본인이 등록한 상품만 수정할 수 있습니다"), 채팅방 접근 권한 없음
(`chat.service.ts:98-100`) 등 정상적인 인가 실패에서도 발생합니다. 서버가 재요청에도 동일하게 403을 반환하므로
보안 구멍은 아니지만, 불필요한 왕복 요청과 사용자에게 에러 메시지가 표시되는 시점의 지연을 유발합니다.

**권장 수정 방향**: CSRF 실패만 별도 식별 가능하도록(예: 에러 응답에 `code: "CSRF_INVALID"` 필드 추가) 서버에서
구분해주고, 프론트는 그 코드가 있을 때만 재시도하도록 좁힌다.

### L-3. CSRF 토큰 비교가 non-constant-time

- **파일**: `backend/src/middleware/csrf.ts:56`

`tokenFromCookiePair`(`:31-45`) 내부의 서명(HMAC) 비교는 `crypto.timingSafeEqual`을 사용해 타이밍 공격을
의식하고 있지만, 정작 쿠키 토큰과 헤더 토큰을 비교하는 `csrfProtection`의 `cookieToken !== headerToken`
(`:56`)은 일반 문자열 비교입니다. 토큰 길이(64자 hex)와 네트워크 타이밍 노이즈를 고려하면 실질적 익스플로잇
가능성은 낮지만, 같은 파일 안에서 타이밍 안전성 기준이 일관되지 않는 점은 코드 리뷰 관점에서 지적할 만합니다.

**권장 수정 방향**: 두 값을 `Buffer`로 변환 후 `crypto.timingSafeEqual`로 비교(길이가 다르면 우선 조기 반환).

---

## 견고성이 확인된 부분 (참고)

- **신고 임계치 트랜잭션** (`report.service.ts:34-61`): `report.create` → `report_count` increment → 조건부
  status 전환이 하나의 `$transaction` 안에서 수행되고, `UPDATE ... SET report_count = report_count + 1`이
  row-lock을 잡으므로 동시 신고가 정확히 직렬화됨. `@@unique([reporterId, targetType, targetId])`
  (`schema.prisma:75`) 덕분에 동일 신고자의 중복 신고로 카운트를 부풀릴 수도 없음.
- **IDOR**: 상품 수정/삭제 전 `assertOwnedByUser`(`product.service.ts:69-80`), 채팅방은 REST/Socket.IO
  양쪽에서 동일한 `assertRoomAccess` 재사용(`chat.service.ts:85-103`, `socket/index.ts:57`), 차단된 상품은
  비소유자에게 404로 은닉(`product.service.ts:60-64`) — 서버 사이드 소유권 검증이 클라이언트 입력을 신뢰하지
  않고 일관되게 적용됨.
- **CSRF 기본 골격**: 더블서브밋 쿠키 + HMAC 서명(`middleware/csrf.ts:14-16`), `SameSite=Lax` 보조 방어,
  CORS `origin`이 `FRONTEND_ORIGINS` 명시적 화이트리스트라 임의 오리진 반사 없음(`env.ts:32`, `app.ts:40-45`).
- **세션 고정 방지**: 회원가입/로그인 성공 시 `req.session.regenerate()` 정상 적용(`auth.routes.ts:11-15, 26, 40`).
- **로그인 정보 노출 방지**: 존재하지 않는 아이디와 비밀번호 불일치를 동일 메시지로 응답(`auth.service.ts:32-39`),
  이 분기는 비밀번호 검증 이후에만 도달하는 `dormant` 체크(`:41-43`)와 섞이지 않아 계정 존재 여부 유추 불가.

---

## 검토 방법

`b9c190c` 단일 커밋의 백엔드 소스(`backend/src/**`)와 프론트엔드 API 클라이언트(`frontend/src/api/client.ts`)를
직접 읽고, `docs/architecture.md`·`docs/research.md`의 설계 의도 및 `REPORT.md`의 항목별 주장과 대조하는
방식으로 진행했습니다. 코드 수정은 수행하지 않았으며, 모든 항목은 실제 소스 코드 확인을 근거로 합니다.

---

## 재검토 결과 (커밋 `62087be`)

검토 대상: `git diff b9c190c 62087be` (17개 파일, +402/-44). 서연이 보고한 수정 내역을 그대로 신뢰하지 않고
각 항목의 실제 diff를 직접 읽어 의도한 동작과 일치하는지 확인했습니다. **5개 항목 모두 해결을 확인했습니다.**

### C-1. Socket.IO 즉시 무효화 — ✅ 해결 확인

- `backend/src/events.ts` (신규): 단일 프로세스용 `EventEmitter` 기반 도메인 이벤트 버스. 다중 인스턴스
  확장 시 Redis Pub/Sub 전환이 필요하다는 한계도 주석에 명시되어 있어 범위를 벗어나지 않으면서도 향후
  트랩을 문서화해둔 점이 좋음.
- `report.service.ts:36-73`: `becameDormantUserId`를 트랜잭션 **내부**에서 세팅하되 `domainEvents.emitEvent`
  호출은 `$transaction` 블록이 **성공적으로 resolve된 이후**에만 실행됨을 확인 — 롤백 가능성이 있는 상태에서
  소켓을 끊는 경우가 없도록 순서가 정확함.
- `socket/index.ts:21-23, 54-71`: 연결 시 `socket.join(personalRoom(user.id))`로 유저별 room에 가입시키고,
  `domainEvents.onEvent("user:dormant", ...)` 리스너를 `io.on("connection", ...)` **밖**(서버 생성 시 1회)에
  등록 — 연결마다 리스너가 누적되는 메모리 누수 없음을 확인. `server.ts:11`에서 `createSocketServer`가
  1회만 호출되는 것도 확인.
- `io.in(personalRoom(userId)).disconnectSockets(true)`로 해당 유저의 모든 탭/기기 소켓을 강제 종료.
- 프론트 `SocketContext.tsx:31-43`: `disconnect` 이벤트의 `reason === "io server disconnect"`만 필터링해
  네트워크 끊김/재연결과 서버측 강제 종료를 구분 — Socket.IO 공식 문서상 정확한 판별 방식.
- `REPORT.md` 12번 검증 항목: 실제 socket.io-client 스크립트로 "신고 3번째 요청의 HTTP 응답이 도착하기도
  전에 disconnect 발생"까지 확인했다고 기술 — EventEmitter가 동기 실행되는 특성과 부합하는 결과.
- `docs/architecture.md` §5에 설계 변경("v1.1")이 소급 반영되어 문서-코드 정합성도 유지됨.

### M-1. `startDirectRoom` TOCTOU 레이스 — ✅ 해결 확인

- `chat.service.ts:44-67`: `tx.chatRoom.create`를 `try/catch`로 감싸 `P2002` 발생 시 `findUnique`로
  기존 row를 재조회해 반환. 재조회 결과가 없는 극단적 edge case에서는 원본 에러를 그대로 rethrow하도록
  방어적으로 처리되어 있어 침묵 실패(silent failure)가 없음.
- `report.service.ts`가 이미 쓰던 "P2002 캐치 → 재조회" 패턴과 동일한 스타일로 일관성 있게 적용됨.
- `REPORT.md` 검증: 동시 8건 요청 → 전부 201, 동일 room id로 수렴, 500 없음.

### L-1. 로그아웃 시 CSRF 쿠키 미삭제 — ✅ 해결 확인

- `auth.routes.ts:60`에 `res.clearCookie(CSRF_COOKIE_NAME, { path: "/" })` 추가. `path: "/"`가
  `issueCsrfCookie`가 쿠키를 설정할 때 쓴 값과 동일해 정상적으로 삭제됨(Express `clearCookie`는 옵션이
  set 시점과 일치해야 지워짐 — 이 부분도 맞게 처리됨).

### L-2. 프론트가 모든 403을 CSRF 실패로 재시도 — ✅ 해결 확인

- `HttpError`에 선택적 `code` 필드 추가(`lib/HttpError.ts`), `csrfProtection`만 `"CSRF_INVALID"`를 실어
  던짐(`csrf.ts:71`), `errorHandler.ts:41`이 `code`가 있을 때만 응답 바디에 실어줌 — 다른 `HttpError`
  발생지점(IDOR 403 등)은 여전히 `code` 없이 응답되므로 회귀 없음.
- `frontend/api/client.ts`: 403 재시도 판단을 `res.status === 403` 단독 조건에서
  `data?.code === "CSRF_INVALID"` 조건으로 좁힘. 위치도 `data`가 파싱된 **이후**로 옮겨져 로직 순서가 맞음.
- 이 변경에 맞춰 재시도 로직에 의존하지 않게 된 `ChatPanel`/`ChatRoomPage`/`MainPage`/`UserProfilePage`의
  누락된 `.catch`도 함께 보강되어, 이제 인가 실패가 빈 화면 대신 명시적 에러/폴백으로 처리됨(리뷰 범위
  밖이지만 관련성 있는 개선이라 확인).

### L-3. CSRF 토큰 비교 non-constant-time — ✅ 해결 확인

- `csrf.ts:47-53`의 `tokensMatch`가 길이 비교 후 `crypto.timingSafeEqual`을 사용하도록 수정. `timingSafeEqual`이
  길이가 다르면 예외를 던지는 특성을 정확히 인지하고 길이 체크를 먼저 수행한 점도 올바름.

### 부가 확인

- `cd backend && npx tsc --noEmit`, `cd frontend && npx tsc --noEmit` 모두 에러 없이 통과.
- `SocketContext.tsx`가 `useNavigate`를 쓰지만 `main.tsx`에서 `SocketProvider`가 `BrowserRouter` 내부에
  마운트되어 있어 Router 컨텍스트 에러 없음. `refreshUser`는 `AuthContext.tsx`에 `useCallback`으로 이미
  안정적으로 존재.

### 결론

원본 리뷰의 Critical 1건, Medium 1건, Low 3건 **전 항목 해결을 코드 레벨에서 확인**했습니다. 새로 발견된
회귀나 부작용은 없습니다. 병합 가능한 상태로 판단합니다.

---

## v1.2 확장 리뷰 (송금/검색/관리자) — Cycle 1

검토 대상: 커밋 전 working tree diff. `backend/src/services/wallet.service.ts`, `admin.service.ts`,
`routes/wallet.routes.ts`, `admin.routes.ts`, `middleware/admin.ts`, `prisma/schema.prisma`+migration,
`scripts/promoteAdmin.ts`, 관련 frontend 파일. 사용자 지침에 따라 이 기능군은 매 재제출마다 이전 통과
여부와 무관하게 전체 재검토합니다.

이번 라운드는 코드 리딩에 더해, 서연이 REPORT.md 15번에 서술한 재현 결과를 그대로 신뢰하지 않고
**로컬에 실제 서버(Postgres 컨테이너 `tsp-postgres` + `npx tsx src/server.ts`)를 띄워 별도로 작성한
스크립트로 동일 위협을 독립 재현**했습니다(서연의 `test_edge_cases.js`는 저장소에 커밋되어 있지 않아
직접 읽을 수 없었으므로).

### 1. `wallet.service.ts` sorted-lock-order + P2034 재시도 — ✅ 안전 확인

- `debitAndSnapshot`이 `updateMany({ where: { userId, balance: { gte: amount } }, ... })`로 조건부 UPDATE를
  쓰는 것을 확인 — WHERE절이 포함된 UPDATE는 Postgres가 행 잠금을 잡고 동시 요청을 직렬화하므로, 잔액 검증과
  차감이 원자적입니다.
- `transfer()`가 sender/receiver 중 **역할과 무관하게 항상 id 문자열 정렬 순서**로 지갑 행에 접근하는 것을
  확인 — 두 당사자 간 반대 방향 동시 송금(A→B, B→A)이 항상 같은 순서로 잠금을 시도하게 되어 고전적인
  circular-wait 데드락이 구조적으로 발생할 수 없습니다(자원 정렬 기반 데드락 방지의 표준 기법이며, 각
  트랜잭션이 정확히 2개 행만 잠그므로 임의의 동시 송금 조합에 대해서도 일반화되어 성립).
- **독립 재현**: 직접 작성한 스크립트로 잔액 10000인 계정에서 6000+6000을 `Promise.all`로 진짜 동시에
  발사 → 하나는 200(잔액 4000), 하나는 409("잔액이 부족합니다"), 최종 A=4000/B=16000(합계 20000 보존,
  이중차감 없음). 서연의 보고와 정확히 일치.
- **독립 재현**: A↔B 반대 방향 송금 16건(각 방향 8건)을 전부 `Promise.all`로 동시 발사 → 210ms 내 전부
  200, 데드락/타임아웃 없음.
- P2034(데드락) 재시도는 `MAX_TRANSFER_ATTEMPTS=2`(1회만 재시도, 백오프 없음) — 락 정렬로 이미 구조적으로
  데드락이 없어야 하므로 사실상 거의 발동하지 않을 안전망이며, 이 정도로 충분합니다. 재시도 후에도 P2034가
  또 발생하면 `HttpError`가 아닌 원본 에러를 그대로 던져 `errorHandler`의 catch-all(500)로 빠지는데, 이건
  "절대 일어나선 안 되는 상황"이므로 조용히 삼키지 않고 로그에 남는 게 맞는 방향입니다.
- 멱등키(`(senderId, idempotencyKey)` UNIQUE + P2002 캐치 후 재조회) 구조도 확인 — **독립 재현**: 동일
  idempotencyKey로 순차 재요청 시 새 송금이 생성되지 않고 동일한 transfer id가 반환됨을 확인.

### 2. BigInt 직렬화 — ✅ 누락 없음 확인

- `Wallet.balance`/`Transfer.amount`/`senderBalanceAfter`/`receiverBalanceAfter` 4개 BigInt 필드가 응답에
  노출되는 모든 경로(`serializeSelfUser`, `serializeTransfer`, `getBalance`)에서 `.toString()`으로 변환됨을
  코드로 확인. `grep`으로 `res.json(`이 wallet/balance/BigInt 필드를 직접(미변환) 내보내는 지점이 없는지
  전수 확인 — 없음.
- `PUBLIC_USER_SELECT`(타인 프로필 조회, `GET /api/users/:id`)에는 애초에 `wallet` 필드 자체가 select되지
  않아, 변환 누락 여부와 무관하게 타인 잔액이 노출될 수 없는 구조 — 정보노출 관점에서도 적절.
- admin 쪽(`listUsers`, `listProductsAdmin` 등)도 BigInt 필드를 select하지 않아 해당 없음.

### 3. `requireAdmin` 역할 변경 즉시 반영 — ✅ 확인 (직접 재현)

- 코드 확인: `middleware/auth.ts`의 `attachCurrentUser`가 매 요청마다 `prisma.user.findUnique`로 전체 행(role
  포함)을 재조회하고 `req.currentUser`에 채워 넣음 — `requireAdmin`은 이 값만 읽으므로 별도 캐싱/세션에 박제된
  role이 없음.
- **독립 재현**: 실제 관리자로 로그인해 세션 쿠키를 확보한 뒤, **그 세션은 그대로 둔 채** DB에서 직접
  `role`을 `admin → user`로 변경(관리자가 다른 관리자를 강등하는 상황을 시뮬레이션) → **재로그인 없이 동일
  쿠키로** `/api/admin/users` 호출 시 즉시 403. 승격의 반대 방향(강등)도 동일한 즉시성으로 동작함을 확인.
- 양성 대조군도 확인: 실제 admin 세션으로는 `/api/admin/users`, `/api/admin/wallet/transactions` 모두 200
  (라우트 자체가 전원에게 깨져서 403 뜨는 게 아님을 확인).

### 4. 관리자 상품 삭제와 일반 삭제 로직 분리 — ✅ 확인

- `admin.service.ts`의 `deleteProductAdmin`은 소유권 검증 없이 `id`만으로 삭제 — `product.service.ts`의
  `deleteProduct`/`assertOwnedByUser`를 import하거나 호출하지 않는 완전히 독립된 함수임을 코드로 확인.
- `git diff`로 `product.routes.ts`의 일반 `DELETE /api/products/:id` 라우트(및 `assertOwnedByUser` 소유권
  검증)가 이번 변경에서 **전혀 건드려지지 않았음**을 확인 — admin 기능 추가가 기존 일반 삭제 경로에 실수로
  섞여 들어가지 않았습니다.

### 5. `requireAdmin` 라우트 커버리지 — ✅ 라우트 등록 코드 + 실제 호출로 이중 확인

- `admin.routes.ts:20`에서 `adminRouter.use(requireAuth, requireAdmin)`가 **9개 라우트 정의보다 먼저,
  파일 최상단**에 한 번만 등록되어 있어 이후 등록되는 모든 하위 라우트에 예외 없이 적용됨을 코드로 확인
  (요청 시점에 이 위치를 우회할 라우트 등록 순서 문제 없음).
- **독립 재현**: 일반 유저 세션으로 9개 엔드포인트(유저 목록/휴면/활성화, 상품 목록/삭제/차단해제, 신고
  목록/처리, 관리자 송금내역) 전부 직접 호출 → 전부 403. 서연이 보고한 9개 카운트와 일치.

### 부가 확인

- `role: "admin"`을 회원가입 요청 바디에 넣어도(Zod 스키마에 필드 자체가 없어) 무시되고 `user`로 생성됨을
  독립 재현으로 확인.
- 자기송금 400, 잔액 초과 409, 검색 기능은 Prisma `contains` 파라미터 바인딩이라 SQLi 표면 없음(코드
  확인 — `status: "active"` 필터가 검색 결과에도 그대로 적용되어 차단 상품이 검색으로 우회 노출되지 않음).
- DB CHECK 제약(`wallets_balance_non_negative`) **독립 재현**: 애플리케이션을 완전히 우회해
  `$executeRawUnsafe`로 잔액을 -500으로 직접 UPDATE 시도 → Postgres 에러 코드 `23514`(check_violation)로
  거부, 잔액 변경 없음(3889 → 3889)을 실제 에러 메시지까지 확인.
- `backend`/`frontend` `tsc --noEmit` 모두 통과.

### 프로세스 제안 (블로커 아님) — Cycle 1에서 제기, Cycle 2에서 반영 확인

서연이 언급한 `test_edge_cases.js`가 저장소에 커밋되어 있지 않아 이번엔 직접 서버를 띄워 별도 스크립트로
재검증했습니다. 다음 라운드부터는 이 스크립트를 `backend/scripts/` 등에 커밋해주시면, 매번 새로 스크립트를
작성하지 않고 동일 스크립트로 회귀 여부까지 함께 확인할 수 있어 더 좋을 것 같습니다.

**Cycle 2 업데이트 (커밋 `7999e2e`)**: `backend/scripts/verifyWalletAdminEdgeCases.js`로 정리되어 커밋됨
(`npm run verify:wallet-admin --workspace backend`). 코드를 직접 읽어 동시성 케이스(1번 레이스, 2번의 동시
3건)가 실제로 `Promise.all`로 병렬 발사되는 구조임을 확인 — 순차 호출을 동시성처럼 포장한 게 아님. 로컬
서버를 띄워 스크립트를 직접 실행해 재확인: 관리자 계정 미설정 시 19 passed(대조군 1건 SKIP), 테스트 계정을
`promoteAdmin.ts`로 승격시켜 `VERIFY_ADMIN_USERNAME`/`VERIFY_ADMIN_PASSWORD`를 채운 뒤 재실행하니 **20
passed, 0 failed**로 대조군까지 전부 통과. 제안이 정확히 의도한 대로(회귀 확인용으로 재사용 가능한 스크립트)
반영됨을 확인.

### 결론

이번 Cycle 1(+ 스크립트 커밋 반영한 Cycle 2 확인) 기준으로 지적한 4가지 중점 사항(동시성 안전, BigInt
직렬화, 관리자 권한 즉시 반영, 삭제 로직 분리) 모두 코드 리딩과 독립 재현 양쪽에서 확인했고, 자기송금/잔액초과/DB CHECK 우회/관리자 라우트
전수 방어까지 함께 검증했습니다. **현재 diff는 병합 가능한 상태로 판단합니다.**

---

## 리팩토링 리뷰 (refactor/agile-v2)

검토 대상: `git diff main` (39개 파일, +457/-412) + untracked 신규 파일 전체 (`backend/src/lib/pagination.ts`,
`frontend/src/hooks/*` 3개, `frontend/src/components/Loading.tsx`, backend/frontend `Dockerfile`,
`backend/docker-entrypoint.sh`, `frontend/nginx.conf`, `docker-compose.yml`, `.env.example`,
`.dockerignore` ×3, `docs/deploy-handoff.md`). 민준(백엔드 동작 보존 리팩토링), 수아(프론트 훅 추출),
지훈(배포 구성)의 Sprint 1 병렬 작업 결과입니다.

**검토 제약**: 이 환경에는 DB/Docker가 없어 정적 분석 + diff 전후 대조로 진행했습니다.
`npm run typecheck` (backend/frontend), `npm run build --workspace backend`(Dockerfile 빌드 스텝과 동일 명령),
그리고 Dockerfile deps 스테이지의 `npm ci --workspace backend --include-workspace-root=false`를
빌드 컨텍스트와 동일한 파일 구성(루트 package.json+lockfile+backend/package.json만, frontend 워크스페이스 부재)으로
스크래치 디렉토리에서 시뮬레이션해 통과를 확인했습니다. 런타임이 필요한 항목은 아래 Sprint 3 체크리스트로 넘깁니다.

### 요약

| 심각도 | 개수 |
|---|---|
| Critical | 0 |
| Medium | 0 |
| Low / Nit | 5 |

동작 보존 위반과 보안 불변식 회귀는 **발견하지 못했습니다**. 이전 리뷰에서 검증했던 보안 경로
(csrf.ts, socket/index.ts, report.service.ts, chat.service.ts, auth.service.ts, events.ts)는
`git diff main`이 전부 비어 있어 코드 레벨에서 무변경임을 확인했습니다.

### 🟢 Low / Nit

#### R-1. `useAsyncData` 도입 후에도 404 외 조회 실패가 무한 로딩으로 표시됨

- **파일**: `frontend/src/pages/ProductDetailPage.tsx:21-26`, `frontend/src/pages/UserProfilePage.tsx:37-40`
- **문제**: `useAsyncData`가 `error`를 캡처하지만, 페이지는 `error.status === 404` 분기만 사용합니다.
  네트워크 실패·500 등 다른 에러는 `loading=false, product=null` 상태가 되어 `<Loading />`이 영원히 표시됩니다.
- **재현**: 상품 상세를 연 상태에서 백엔드를 내리고 새로고침 → "불러오는 중..."이 계속 표시.
- **판정**: 리팩토링 전에도 동일하게 "불러오는 중..."에 머물렀으므로(구 코드는 `.catch`에서 rethrow → unhandled
  rejection) **동작 보존 위반은 아님**. 다만 이제 에러가 훅에 잡혀 있으므로 한 줄이면 고칠 수 있습니다.
- **권장**: `if (error) return <div className="empty-state">불러오지 못했습니다...</div>` 류의 일반 에러 분기 추가.

#### R-2. `/health/ready` 실패가 백엔드 로그에 남지 않음

- **파일**: `backend/src/app.ts:52-59`
- **문제**: readiness 체크의 `catch {}`가 에러를 완전히 삼킵니다. DB가 죽어 컨테이너가 unhealthy로 뒤집혀도
  백엔드 로그에는 아무 흔적이 없어, 운영 중 "왜 unhealthy인가"를 로그로 진단할 수 없습니다.
  (try/catch로 asyncHandler 없이도 rejection이 새지 않게 한 구조 자체는 올바름 — Express 4에서 async 핸들러의
  미처리 rejection은 프로세스 레벨로 새는데, 여기선 전체가 try로 덮여 있어 문제없음을 확인.)
- **권장**: catch에서 `console.error("[health] readiness check failed:", err)` 1줄 추가 (30초 간격 프로브라 로그 폭주 우려 없음).

#### R-3. 배포 문서 2곳이 compose healthcheck 경로를 `/health`로 기술 (실제는 `/health/ready`)

- **파일**: `docs/architecture.md:475` ("backend `/health` healthcheck 통과 → frontend 기동"),
  `docs/deploy-handoff.md:21` ("compose의 backend healthcheck가 이를(`/health`) 사용")
- **문제**: `docker-compose.yml`의 backend healthcheck는 `/health/ready`를 호출합니다(B-2 반영 후 교체됨).
  두 문서 문장은 교체 전 상태로 남아 있습니다. deploy-handoff는 B-2 행에서 스스로 정정하고 있어 오독 위험은 낮지만,
  architecture.md §11.2는 정정 문구가 없습니다.
- **권장**: 두 문장을 `/health/ready`로 수정 (문서만, 코드 무관).

#### R-4. nginx 정적 자산(`/assets/`) 응답에 보안 헤더 없음 + SPA CSP의 `ws:`/`wss:`가 호스트 무제한

- **파일**: `frontend/nginx.conf:78-84` (`location /assets/`), `:96` (CSP)
- **문제**: (a) nginx `add_header`는 location에 자체 `add_header`가 있으면 상위 레벨을 상속하지 않는데,
  이 설정은 보안 헤더를 `location /`에만 두었으므로 `/assets/`의 JS/CSS 응답에는 `X-Content-Type-Options` 등이
  붙지 않습니다. (b) SPA 문서의 CSP `connect-src 'self' ws: wss:`는 스킴 전체 허용이라 helmet의
  `connectSrc: 'self'+FRONTEND_ORIGINS`보다 느슨합니다 (주석에 호환성 의도가 명시되어 있긴 함).
- **재현**: `curl -sI http://localhost:8080/assets/<번들>.js | grep X-Content-Type` → 없음.
- **권장**: 공통 보안 헤더를 include 파일이나 server 레벨+`location /assets/` 양쪽에 명시. CSP는 XSS 방어가
  실질 목적이므로 현 수준도 수용 가능 — 취향 문제로 블로커 아님.

#### R-5. `DATABASE_URL`이 비밀번호를 URL 인코딩 없이 보간

- **파일**: `docker-compose.yml:44`
- **문제**: `postgresql://...:${POSTGRES_PASSWORD}@postgres:5432/...` 문자열 보간이라, 비밀번호에
  URL 예약문자(`@` `:` `/` `#` `?` `%`)가 들어가면 접속 실패(혹은 더 헷갈리는 파싱 오류)가 됩니다.
  `.env.example`이 `openssl rand -hex`를 권장하고 있어 안내대로 하면 안전하지만, 제약이 명시돼 있지 않습니다.
- **권장**: `.env.example`의 POSTGRES_PASSWORD 항목에 "URL-safe 문자만(hex 권장)" 주석 1줄 추가.

### 확인한 견고성 (diff 전후 대조 근거)

**1. 동작 보존 — 백엔드 (민준)**

- **페이지네이션 통합**: `lib/pagination.ts`의 `cursorPageArgs`/`toCursorPage`가 기존 5곳
  (product.listProducts, admin.listUsers/listProductsAdmin/listReports, wallet.listAllTransactions)의
  인라인 코드와 **문자 그대로 동일한 로직**(fetch limit+1, slice, nextCursor=마지막 항목 id ?? null)임을
  각 diff 양쪽을 대조해 확인. `before` 기반 페이지네이션(chat 메시지, wallet 내 거래내역)은 건드리지 않음.
- **Zod transform**: `adminReportListQuerySchema.resolved`가 라우트의 수동 `=== "true"` 변환을 스키마
  transform으로 흡수 — `undefined`/`"true"`/`"false"`/그 외(ZodError→400) 전 케이스 동일 결과.
- **listReports target 재구성**: `has()+get()!` 패턴 → label 변수 패턴으로 바뀌었지만 `null`(대상 삭제됨)
  판정과 `{type,id,label}` 형태 동일. `frontend/src/types/index.ts`의 `AdminReport.target`과 일치.
- **logout**: 콜백 스타일 → `destroySession`+`HttpError(500)`. errorHandler가 `{ error: message }`로
  직렬화하므로 실패 시 상태코드(500)·메시지·성공 시 204 + 쿠키 2종(`tsp.sid`, CSRF) 삭제 순서 모두 동일.
- **`/health` 이동**: 응답 형태 `{ok:true}` 동일. 세션/limiter 앞 등록은 의도된 변경(deploy-handoff B-1)이고,
  helmet(1번째 미들웨어)보다는 뒤라 보안 헤더는 유지됨. `/api` 계약 무관.
- **requireCurrentUser**: 전 라우트의 `req.currentUser!` 치환. requireAuth 뒤에서만 호출되며, 폴백 throw도
  requireAuth의 401 응답(`로그인이 필요합니다.`)과 동일 형태.
- **죽은 코드 제거 검증**: `getBalance`/`GLOBAL_ROOM_MARKER`/`TransferInput`/`UPLOAD_DIR` export가
  main 기준으로도 참조 0건임을 `git grep main`으로 확인 — 안전한 제거.

**2. 보안 불변식 (docs/review.md 기존 검증 항목) — 전부 유지**

- 세션 regenerate(가입/로그인), CSRF HMAC+timingSafeEqual+`CSRF_INVALID` 코드, Socket.IO
  `user:dormant` 리스너(connection 핸들러 **밖** 등록, 트랜잭션 커밋 후 emit), 신고/지갑 트랜잭션
  (정렬 잠금, P2002/P2034), 회원가입 role 미허용: 해당 파일들 diff 비어 있음 + socket/index.ts 직접 재독으로 확인.
- admin 라우트 가드: `adminRouter.use(requireAuth, requireAdmin)`이 여전히 라우트 정의보다 앞 (admin.routes.ts:20).
- attachCurrentUser 매 요청 재조회: 본문 무변경 (requireCurrentUser 추가만).
- BigInt 직렬화: serializeTransfer/serializeSelfUser 무변경, 제거된 getBalance는 미사용 함수.
- 프론트 403 재시도가 `code === "CSRF_INVALID"` 조건 유지 (client.ts:95).

**3. 동작 보존 — 프론트엔드 (수아)**

- `useAsyncData`: cancelled 플래그로 stale 응답/late setState 가드, deps 변경 시 cleanup, `reload`는
  reloadKey 증가로 동일 effect 재실행 — 각 페이지의 기존 수동 구현과 대조해 로딩/에러/폴백(.catch → null/[]
  fallback을 fetcher 안으로 이동) 의미 동일. `[...deps, reloadKey]` 스프레드는 콜사이트별 길이 고정이라 안전.
- `useFormSubmit`: submitting/에러 클리어/ApiError 메시지 패스스루/폴백 문자열 — 7개 폼의 기존 인라인 로직과
  동일. LoginPage의 403 휴면 안내 특수 분기는 mapper 함수로 보존. MyPage 비밀번호 불일치 조기 return 시
  `setError` 후 재클리어 없음(에러 표시됨) 확인.
- `useStartChat`: 미로그인 → /login, 성공 → /chat/:id, 실패 → 인라인 메시지 — 두 콜사이트(상품 상세/프로필)의
  기존 로직과 동일. ProductDetailPage만 `starting`으로 버튼 disable하는 것도 기존과 동일.
- `buildQuery`: `value !== undefined` 체크라 `resolved=false`가 **누락되지 않고** `?resolved=false`로 직렬화됨
  (naive falsy 체크였다면 ReportsTab 미해결 필터가 깨졌을 부분 — 올바르게 처리됨). URLSearchParams 인코딩은
  기존 encodeURIComponent 사용처(before=ISO타임스탬프)와 결과 동일.
- `SocketContext` socketRef 제거: user 전환 시 이전 effect cleanup이 disconnect를 담당하는 구조로 단순화 —
  로그아웃(user→null), 유저 전환, 언마운트 세 경로 모두 기존과 동일한 disconnect 시점. `io server disconnect`
  분기(즉시 무효화 UX) 무변경.
- `Badge` danger variant 제거: `variant="danger"` 사용처 0건(grep), 관련 CSS만 함께 제거 — 안전.

**4. 크로스 경계 계약**

- `types/index.ts` ↔ 백엔드 직렬화: SelfUser.balance(string) ↔ serializeSelfUser, Transfer 4개
  BigInt 필드(string) ↔ serializeTransfer, AdminReport.target ↔ listReports, ProductListItem{id,name} ↔
  listProducts select — 전부 일치, 이번 diff로 달라진 필드 없음.
- typecheck 양쪽 통과 (직접 실행).

**5. 배포 구성 (지훈) — 정적 대조로 확인된 것**

- Dockerfile이 참조하는 스크립트/경로 실물 일치: `prisma:generate`/`build`/`typecheck` 스크립트,
  `node_modules/prisma/build/index.js`(존재 확인), `dist/server.js`, `backend/docker-entrypoint.sh`,
  `frontend/index.html·vite.config.ts·tsconfig.json·src`(vite-env.d.ts는 src 안), `frontend/public` 미COPY는
  실제로 비어 있고 untracked라 타당.
- 업로드 경로 산술: dist/app.js(`__dirname/..`→/app/uploads) · dist/upload/imageProcessor.js
  (`__dirname/../..`→/app/uploads/products) ↔ 볼륨 마운트 `/app/uploads` ↔ `mkdir -p uploads/products` +
  `chown node` — 일치.
- compose 환경변수 14개 ↔ env.ts envSchema 14개 키 완전 일치(필수 3개는 `:?` 가드, 나머지는 기본값 동반).
  시크릿은 이미지에 박제되지 않음: `.env`는 COPY 없음 + 루트 `.dockerignore`의 `**/.env`/`**/.env.*`,
  빌드타임 ENV는 `VITE_API_BASE_URL=""`(비밀 아님) 뿐.
- nginx 프록시 3경로(/api·/uploads·/socket.io) = vite dev proxy 3경로, WebSocket은 map+Upgrade/Connection
  헤더·1h 타임아웃·buffering off, XFF/XFP 전달 ↔ backend `trust proxy 1`/rate limiter/COOKIE_SECURE 요건 부합.
- healthcheck ↔ 계약: compose의 `fetch(...).then(r=>exit(r.ok?0:1))` ↔ `/health/ready` 200/503 정확히 대응.
  entrypoint는 migrate deploy 5회/3초 재시도 후 `exec node dist/server.js`(PID 1, SIGTERM 직결 —
  server.ts graceful shutdown과 부합). `set -eu`+`until` 조합도 올바름(조건부 실패는 -e에 안 걸림).
- `.dockerignore`(루트)가 컨텍스트 기준과 일치: node_modules/dist/uploads/.env류 제외가 두 Dockerfile의
  COPY 대상과 충돌 없음. README의 psql 승격 명령(`UPDATE users ...`)은 `@@map("users")`와 일치.
- 루트 워크스페이스 부분 컨텍스트에서의 `npm ci --workspace backend` — frontend/package.json 없는 구성으로
  시뮬레이션 통과(176 packages). `tsc -p tsconfig.json` 빌드도 로컬에서 통과.

### Sprint 3 런타임 검증 필수 체크리스트

정적으로 확인 불가능해 이번 리뷰에서 통과 판정을 **보류**한 항목들. `docs/deploy-handoff.md` §2의 절차가
잘 짜여 있으므로 그것을 기준으로 하되, 아래는 이번 리뷰 관점에서 특히 놓치면 안 되는 것들:

1. `docker compose up -d --build` 첫 실빌드 — 특히 (a) prod-deps 스테이지 `--omit=dev` 설치,
   (b) 런타임 이미지에서 prisma CLI 선별 복사본(`prisma`+`@prisma/*`+`.prisma`)만으로 `migrate deploy`가
   실제로 도는지 (엔진 바이너리 경로 해석은 정적 확인 한계), (c) sharp self-check 경고 부재.
2. `/health/ready` 실계약: 정상 시 200 `{"status":"ready"}`, **postgres 컨테이너만 중지 후** 503
   `{"status":"unavailable"}` + backend가 unhealthy로 전환되는지. (참고: pg 커넥션 풀 타임아웃이 compose
   healthcheck `timeout: 5s`보다 길면 503 대신 healthcheck 타임아웃으로 잡힐 수 있음 — 어느 쪽이든
   unhealthy면 계약 충족이지만 확인 필요.)
3. nginx 경유 Socket.IO가 websocket으로 업그레이드되는지(DevTools에서 101, polling 고착 아님) + 신고 누적
   휴면 전환 시 소켓 즉시 강제 종료 → 로그인 페이지 이동 UX가 프록시 뒤에서도 동작하는지 (기존 REPORT.md
   12번 검증의 배포 환경 재실행).
4. 프록시 뒤 rate limiter가 XFF 기준으로 클라이언트별 분리되는지 (로그인 6회 → 429), CSRF 403 재시도 플로우.
5. 페이지네이션 회귀: 상품 21개 이상 등록 후 목록 `nextCursor` 체인으로 끝까지 순회 — 중복/누락/마지막 페이지
   `nextCursor:null` 확인 (pagination.ts 통합 후 실측은 아직 없음). admin 목록도 동일.
6. `useAsyncData` 경합 실측: 검색어 연타(appliedSearch 연속 변경) 시 stale 응답이 목록을 덮어쓰지 않는지,
   "더 보기" 도중 검색 변경 시 목록이 섞이지 않는지.
7. 업로드 볼륨 영속(컨테이너 재생성 후 이미지 200) + 세션 영속(backend 재시작 후 로그인 유지) +
   `migrate deploy` 멱등(재기동 시 "No pending migrations").
8. `npm run verify:wallet-admin` 스크립트를 배포 스택(nginx 경유)에 맞춰 1회 실행 — 지갑/관리자 불변식의
   배포 환경 회귀 확인.

### 결론

세 사람의 작업 모두 **동작 보존·보안 불변식 관점에서 회귀 없음**을 코드 레벨에서 확인했습니다. 발견 사항은
Low 5건(수정 1줄~문서 수준)이며 병합 블로커가 아닙니다. 단, 배포 구성은 이 환경 제약상 실빌드/실기동이
한 번도 수행되지 않았으므로, **위 체크리스트 1~4번을 Sprint 3 서두에 반드시 실행**한 뒤에 배포 구성을
"검증 완료"로 취급해야 합니다.
