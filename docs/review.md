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
