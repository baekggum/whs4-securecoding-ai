# 보안 구현 리포트

작성자: 서연 (개발자)
상태: 코드 리뷰(태양) 1차 반영 완료 + 종합 재검증(13번) 완료 + Windows 실사용 버그 2건 수정 및 리뷰 반영 완료(14번) + v1.2 확장(송금/검색/관리자) 구현·검증·태양 리뷰(Cycle 1) "병합 가능" 판정 완료(15번) + Sprint 3 사전 전 기능 E2E 회귀 검증(refactor/agile-v2) 44/44 통과(16번)

이 문서는 `docs/architecture.md`(민준), `docs/research.md`(지훈)에서 지정한 보안 요구사항을
실제로 어떻게 구현했는지, 그리고 로컬 환경에서 어떻게 동작을 검증했는지 정리합니다.
"발견한 보안 약점 → 어떻게 수정/방어했는지" 형식으로 항목별로 기술합니다.

---

## 1. 비밀번호 저장 (해싱)

**약점**: 평문 저장, 또는 가역 암호화, 또는 약한 해시(MD5/SHA1)로 저장 시 DB 유출 시 전체 계정 탈취.

**조치**:
- `bcrypt` (cost factor 12, `backend/src/lib/password.ts`) 로 해싱. `BCRYPT_SALT_ROUNDS` 환경변수로 운영 중 조정 가능.
- 비밀번호는 어떤 로그/응답에도 평문으로 노출되지 않음 (아래 9번 참고).
- 회원가입 시 비밀번호는 8~64자로 제한(zod, `backend/src/validators/auth.schema.ts`) — bcrypt가 72바이트 이상을 자동으로 잘라버리는 특성을 피하기 위해 상한을 둠.
- 비밀번호 변경 시 현재 비밀번호 재확인 필수 (`backend/src/services/user.service.ts` `updatePassword`).

**검증**: 회원가입 후 DB의 `password_hash` 컬럼이 `$2b$...` 형태의 bcrypt 해시임을 확인. 잘못된 현재 비밀번호로 변경 시도 시 400 응답 확인.

---

## 2. SQL Injection

**약점**: 문자열 concat으로 쿼리를 조립하면 사용자 입력이 SQL 구문으로 해석될 수 있음.

**조치**:
- 모든 DB 접근을 Prisma ORM의 표준 CRUD API로만 수행 (`backend/src/services/*.ts`). `$queryRaw`/`$queryRawUnsafe`는 코드베이스 어디에도 사용하지 않음.
- Prisma의 표준 API는 내부적으로 파라미터 바인딩을 강제하므로 입력값이 쿼리 구조에 영향을 줄 수 없음.

**검증**: 상품명/신고 사유 등에 `' OR 1=1; DROP TABLE users; --` 형태의 문자열을 입력해도 일반 문자열 데이터로만 저장되고 쿼리 구조에 영향 없음을 확인 (Prisma가 항상 prepared statement로 변환).

---

## 3. XSS (Cross-Site Scripting)

**약점**: 사용자 입력(소개글, 상품 설명, 채팅 메시지)을 그대로 HTML로 렌더링하면 `<script>` 태그나 이벤트 핸들러 삽입으로 임의 스크립트 실행 가능.

**조치**:
- 프론트엔드는 모든 사용자 입력을 JSX 텍스트 노드로만 렌더링 (`{content}` 형태). React가 기본적으로 이스케이프하므로 별도 파싱 없이 안전.
- `dangerouslySetInnerHTML`은 코드베이스 어디에도 사용하지 않음 (채팅 메시지 렌더링: `frontend/src/components/ChatPanel.tsx`, 상품 설명: `frontend/src/pages/ProductDetailPage.tsx`, 소개글: `frontend/src/pages/UserProfilePage.tsx`).
- 백엔드는 `helmet`의 CSP를 적용해 `script-src 'self'`만 허용, 인라인 스크립트 자체를 차단 (`backend/src/app.ts`).
- 채팅/상품설명/소개글 모두 순수 텍스트로만 저장·전송하며 마크다운/HTML 렌더링을 지원하지 않음.

**검증**: 상품 설명·채팅 메시지에 `<script>alert(1)</script>` 입력 시 브라우저에서 문자열 그대로 표시되고 실행되지 않음을 확인 예정(수동 확인 필요 — 하단 "남은 검증" 참고).

---

## 4. CSRF (Cross-Site Request Forgery)

**약점**: 세션 쿠키 기반 인증은 브라우저가 자동으로 쿠키를 첨부하므로, 공격자 사이트에서 만든 폼이 피해자의 세션으로 상태 변경 요청을 보낼 수 있음.

**조치**:
- Double-Submit Cookie 패턴을 직접 구현 (`backend/src/middleware/csrf.ts`). `csrf-csrf` 등 외부 라이브러리 대신 자체 구현한 이유: HMAC 서명 방식으로 라이브러리 버전 호환성 리스크 없이 정확한 동작을 보장하기 위함.
  - `GET /api/csrf-token`에서 랜덤 토큰 + HMAC 서명을 쿠키(`tsp.csrf`, JS에서 읽을 수 있도록 `httpOnly: false`)로 발급.
  - GET/HEAD/OPTIONS를 제외한 모든 요청은 `X-CSRF-Token` 헤더 값이 쿠키에 서명된 토큰과 일치해야 통과 (`crypto.timingSafeEqual`로 타이밍 공격 방지).
  - 세션 쿠키 자체도 `SameSite=Lax`로 1차 방어.
- 프론트엔드 `frontend/src/api/client.ts`가 모든 mutating 요청에 자동으로 토큰을 첨부하고, 403 발생 시 토큰을 재발급받아 1회 재시도.

**검증**: `X-CSRF-Token` 헤더 없이 `PATCH /api/users/me` 호출 시 403 확인 완료 (curl 테스트).

---

## 5. 세션 관리

**약점**: JWT 등 stateless 토큰은 서버가 발급 후 즉시 무효화할 방법이 없어, "신고 누적 시 즉시 휴면 전환" 같은 요구사항을 만족시키기 어려움. 세션 고정(session fixation) 공격도 고려 필요.

**조치**:
- 세션 기반 인증 채택 (JWT 미사용, `docs/architecture.md` §5 결정 유지). `express-session` + `connect-pg-simple`으로 PostgreSQL에 세션 저장 (`backend/src/session.ts`).
- 쿠키 속성: `httpOnly`, `secure`(운영 환경), `sameSite: 'lax'`, `path: '/'`, rolling expiration 7일.
- **세션 고정 방지**: 회원가입/로그인 성공 시 `req.session.regenerate()`로 세션 ID를 재발급 후 `userId`를 저장 (`backend/src/routes/auth.routes.ts`).
- **즉시 무효화**: 매 요청마다 `attachCurrentUser` 미들웨어(`backend/src/middleware/auth.ts`)가 DB에서 최신 유저 status를 조회. `dormant`이거나 삭제된 유저면 세션을 즉시 파기하고 401 반환 — 신고 누적으로 휴면 처리된 직후의 요청부터 바로 차단됨.
- 로그아웃 시 세션을 DB에서 완전히 삭제(`req.session.destroy`) 후 세션 쿠키와 CSRF 쿠키를 모두 clear (아래 12번 참고).
- Socket.IO도 동일한 세션 미들웨어를 핸드셰이크에 재사용 (`backend/src/socket/index.ts`, `io.engine.use(sessionMiddleware)`) — 별도 토큰 발급 없이 REST와 동일한 세션 검증 로직 공유.

**약점 (코드 리뷰에서 발견, Critical)**: 위 "즉시 무효화"는 REST 요청 경로에만 성립했다. Socket.IO 연결은 handshake 시 1회만 인증되고 이후 오래 유지되는 특성상, 이미 연결된 소켓은 그 유저가 신고 누적으로 `dormant` 전환되어도 세션/DB 재조회 없이 계속 채팅을 주고받을 수 있는 설계 공백이 있었다 (`docs/architecture.md` §5 "WebSocket 연결의 즉시 무효화 보강" 참고 — 태양 리뷰 → 민준이 설계 문서에 반영).

**조치**:
- 소켓 연결 시 전역 room뿐 아니라 유저별 개인 room `user:{userId}`에도 join (`backend/src/socket/index.ts`).
- `report.service.ts`가 dormant 전환 트랜잭션을 커밋한 직후, REST 서비스 레이어가 Socket.IO 서버를 직접 참조하지 않도록 Node `EventEmitter` 기반 도메인 이벤트 `user:dormant`를 발행 (`backend/src/events.ts`) — 트랜잭션이 실제로 커밋된 뒤에만 발행하므로, 롤백 가능성이 있는 상태에서 소켓을 끊는 일이 없음.
- 소켓 계층이 이 이벤트를 구독해 `io.in('user:'+userId).disconnectSockets(true)`로 해당 유저의 모든 연결을 즉시 강제 종료.
- 프론트엔드는 `disconnect` 이벤트의 reason이 `"io server disconnect"`(서버가 명시적으로 끊은 경우에만 오는 값 — 네트워크 문제로 인한 재연결 케이스와 구분됨)일 때 사용자 상태를 재조회하고 로그인 페이지로 리다이렉트 (`frontend/src/context/SocketContext.tsx`).
- 단일 프로세스 전제 — 다중 인스턴스로 확장 시 `EventEmitter`를 Redis Pub/Sub으로 교체 필요(현재 범위에서는 과설계라 문서에만 명시).

**검증**:
- 신고 3회로 유저를 휴면 전환시킨 직후, 그 유저의 기존 세션으로 `/api/users/me` 호출 시 401 확인.
- 동일 계정으로 재로그인 시도 시 403 + "휴면 처리된 계정" 메시지 확인.
- 세션 쿠키 없이 소켓 연결 시 `unauthorized`로 연결 거부, 쿠키 있을 때만 연결 성공 확인.
- **소켓이 연결된 상태에서** 다른 계정 3개로 해당 유저를 신고해 임계치를 넘긴 직후, 소켓이 `disconnect` 이벤트를 `reason: "io server disconnect"`로 수신하며 즉시 끊기는 것을 실제 socket.io-client 스크립트로 확인(신고 3번째 요청의 HTTP 응답이 도착하기도 전에 disconnect가 발생할 정도로 즉각적).

---

## 6. IDOR (Insecure Direct Object Reference)

**약점**: 리소스 ID만 알면 소유권 검증 없이 타인의 데이터를 조회/수정/삭제할 수 있는 취약점.

**조치**:
- 모든 PK는 UUID v4 (순차 정수 ID 추측 방지 — 보조 수단).
- **주 방어는 서버측 소유권 검증**: 상품 수정/삭제 시 `product.sellerId === session.userId`를 서비스 레이어에서 반드시 확인 (`backend/src/services/product.service.ts` `assertOwnedByUser`) — 불일치 시 403.
- 차단된(`blocked`) 상품은 판매자 본인 외에는 조회 시 404 (존재 자체를 숨김, `getProductDetail`).
- 채팅방 접근도 참여자 검증: 1:1 방은 `chat_room_participants`에 실제 참여자로 등록된 경우만 메시지 조회/전송 가능 (`assertRoomAccess`, REST와 Socket.IO 양쪽에서 동일 함수 재사용 — 실시간 경로로 우회 불가).
- 신고 대상(target)도 실제 존재 여부를 서버에서 조회로 검증 후에만 신고 접수.

**검증**: 다른 사용자의 상품을 `PATCH`로 수정 시도 시 403 "본인이 등록한 상품만 수정할 수 있습니다" 확인. 비소유자가 차단된 상품 상세 조회 시 404 확인.

---

## 7. 입력값 검증

**약점**: 서버가 클라이언트 입력을 신뢰하면 타입 불일치, 범위 초과, 예상치 못한 필드로 인한 오류나 로직 우회가 발생할 수 있음.

**조치**:
- 모든 REST 엔드포인트가 컨트롤러 진입 전 Zod 스키마로 body/query/params를 검증 (`backend/src/validators/*.schema.ts`). 실패 시 전역 에러 핸들러가 400 + 필드별 에러 메시지 반환 (`backend/src/middleware/errorHandler.ts`).
- Socket.IO 메시지(`join_room`, `send_message`)도 동일하게 Zod로 검증 (`backend/src/validators/chat.schema.ts`) — REST만 검증하고 실시간 경로는 검증을 건너뛰는 실수를 방지.
- 아이디는 영문/숫자/밑줄 3~20자, 신고 사유는 최소 10자 등 도메인 규칙도 스키마에 포함.

**검증**: 잘못된 형식의 요청(빈 문자열, 범위 초과 가격, 잘못된 UUID) 전송 시 모두 400과 함께 필드별 에러 메시지 반환 확인.

---

## 8. 파일 업로드 검증

**약점**: 클라이언트가 보낸 확장자/Content-Type만 믿으면, 악성 파일을 이미지로 위장해 업로드할 수 있음(예: 폴리글랏 파일, 실행 파일 위장).

**조치** (`backend/src/upload/multer.ts`, `magicBytes.ts`, `imageProcessor.ts`):
1. **1차 필터**: 확장자(jpg/jpeg/png/webp) + 클라이언트 Content-Type 화이트리스트 (참고용, 신뢰하지 않음).
2. **메모리 버퍼 처리**: `multer.memoryStorage()`로 디스크에 즉시 쓰지 않고 검증 전까지 메모리에만 보관.
3. **매직 바이트(실제 파일 시그니처) 검증**: 클라이언트가 보낸 값이 아니라 파일의 실제 바이트를 직접 검사(JPEG `FF D8 FF`, PNG 시그니처, WEBP `RIFF...WEBP`)해 진짜 타입 확인. 초기에는 `file-type` npm 패키지를 쓰려 했으나 ESM-only + Node 22 요구(정규식 `v` 플래그) 로 이 환경의 Node 18과 호환되지 않아, 우리가 허용하는 3개 포맷만 검사하는 자체 구현으로 대체 — 외부 의존성 취약점 표면도 함께 줄임.
4. **크기 제한**: 5MB (`multer` limits).
5. **파일명 랜덤화**: 원본 파일명은 절대 사용하지 않고 서버가 `crypto.randomUUID()`로 재생성 — path traversal/파일명 충돌 방지.
6. **`sharp` 재인코딩**: 검증 통과 후 원본 바이트를 그대로 저장하지 않고 리사이즈(최대 1600px) + JPEG로 재인코딩해 저장. EXIF 메타데이터가 제거되고, 이미지 데이터 뒤에 스크립트를 숨긴 폴리글랏 파일은 재인코딩 과정에서 픽셀 데이터만 남아 무력화됨.
7. **저장 경로**: `/uploads/products`는 정적 파일 서빙 전용 경로로만 노출, 실행 권한 없음. `X-Content-Type-Options: nosniff` 헤더 적용.

**검증**: 실제 jpg 파일 업로드 → sharp 재인코딩된 파일이 디스크에 저장되고 `/uploads/products/<uuid>.jpg`로 정상 서빙됨을 확인.

**남은 위험(문서화)**: `npm audit`에서 `file-type` 패키지 자체의 알려진 취약점(ASF 파서 무한루프, moderate)을 피하기 위해 해당 의존성을 완전히 제거했으므로 이 벡터는 해당 없음. Node 20+ 환경으로 전환 시 `file-type` 재도입도 대안이 될 수 있음(README에 기재).

---

## 9. Rate Limiting

**약점**: 로그인/회원가입에 제한이 없으면 브루트포스 크리덴셜 스터핑, 대량 계정 생성이 가능. 신고 API에 제한이 없으면 소수 계정으로 임계치를 조작해 정상 상품/유저를 악의적으로 차단시킬 수 있음(이 서비스 특유의 리스크).

**조치** (`backend/src/middleware/rateLimiters.ts`):
- `authLimiter`: 로그인/회원가입 — IP당 15분에 5회, 로그인 성공은 카운트 제외(`skipSuccessfulRequests`).
- `reportLimiter`: 신고 생성 — 로그인 유저 기준(IP가 아닌 `userId`) 1시간에 20회. 자동 차단/휴면 로직과 직결되므로 별도로 엄격하게 관리.
- `globalLimiter`: 전체 API에 분당 120회의 완만한 기본 제한.

**검증**: 로그인 5회 연속 실패 시 6번째 요청부터 429 예상 동작 확인 예정(하단 "남은 검증" 참고 — 임계치 낮춰 재현 가능).

---

## 10. 민감정보 로깅 금지

**약점**: 비밀번호, 세션 토큰, CSRF 토큰 등이 서버 로그에 남으면 로그 접근 권한이 있는 누구나 계정을 탈취할 수 있음.

**조치**:
- 전역 에러 핸들러(`backend/src/middleware/errorHandler.ts`)는 예상치 못한 에러의 스택만 서버 콘솔에 로그하고, 요청 바디는 로그하지 않음.
- 애플리케이션 코드 어디에도 `req.body`, 비밀번호, 세션/CSRF 토큰 값을 `console.log`하는 코드가 없음(코드 전수 확인).
- Morgan 등 요청 바디를 그대로 남기는 액세스 로거는 도입하지 않음.

**검증**: 로그인 실패/성공, 회원가입, 비밀번호 변경 등을 반복 호출하며 서버 stdout에 비밀번호 평문이나 세션 ID가 출력되지 않음을 확인.

---

## 11. 에러 메시지에 내부 정보 노출 금지

**약점**: 스택 트레이스, SQL 에러, 파일 경로 등이 응답에 그대로 노출되면 공격자가 내부 구조를 파악하는 데 악용됨.

**조치** (`backend/src/middleware/errorHandler.ts`):
- 예상된 에러(`HttpError`, Zod 검증 실패, Prisma의 잘 알려진 에러 코드 P2002/P2025, Multer 에러)만 클라이언트 안전 메시지로 응답.
- 그 외 모든 예상치 못한 예외는 "서버 오류가 발생했습니다."라는 고정 메시지로만 응답하고, 실제 원인은 서버 콘솔에만 기록.
- 로그인 실패 시 "아이디가 존재하지 않음"과 "비밀번호 불일치"를 구분하지 않고 동일한 메시지로 응답(계정 존재 여부 유추 방지, `backend/src/services/auth.service.ts`).
- 차단된 상품을 비소유자가 조회 시 403이 아닌 404로 응답(상품이 존재한다는 사실 자체를 숨김).

**검증**: 잘못된 로그인 시도 시 "아이디 또는 비밀번호가 올바르지 않습니다" 동일 메시지 확인. 존재하지 않는 리소스 조회 시 스택트레이스 없이 일반화된 메시지만 반환됨을 확인.

---

## 12. 코드 리뷰(태양) 반영 — Medium/Low

### Medium: `startDirectRoom`의 TOCTOU 레이스

**약점**: 두 유저 간 1:1 채팅방 생성은 "기존 방 조회 → 없으면 생성" 순서였는데(`backend/src/services/chat.service.ts`), 두 유저가 거의 동시에 채팅을 시작하면 둘 다 "없음"을 보고 각자 생성을 시도할 수 있음. `chat_rooms(userIdLow, userIdHigh)`에 UNIQUE 제약이 있어 데이터 중복 생성 자체는 막히지만, 나중에 커밋을 시도한 요청은 처리되지 않은 P2002 에러로 500이 발생했다.

**조치**: 생성 트랜잭션에서 `P2002`를 잡아 "누군가 방금 막 생성했다"로 간주하고 해당 room을 다시 조회해 반환하도록 수정 — 동시성 상황에서도 항상 하나의 room으로 수렴하고 500이 발생하지 않음.

**검증**: 두 유저가 서로에게 동시에 8개의 `POST /api/chat/rooms/direct` 요청을 보내는 스크립트로 재현 — 모두 201 응답, 반환된 room id가 전부 동일한 하나로 수렴, 500 없음을 확인.

### Low: 로그아웃 시 CSRF 쿠키 미삭제

**약점**: 로그아웃 시 세션 쿠키만 clear하고 CSRF 쿠키(`tsp.csrf`)는 남아있었다. CSRF 토큰이 세션에 종속되지 않는 자체 서명 방식이라 즉각적인 보안 구멍은 아니었지만, 로그아웃 이후에도 이전 토큰이 재사용 가능한 상태로 남는 것은 불필요한 위생 문제.

**조치**: `backend/src/routes/auth.routes.ts`의 로그아웃 핸들러에서 세션 쿠키와 함께 CSRF 쿠키도 `clearCookie` 하도록 수정.

**검증**: 로그아웃 응답의 `Set-Cookie` 헤더에 `tsp.sid=; Expires=...1970...`와 `tsp.csrf=; Expires=...1970...`가 모두 포함됨을 확인.

### Low: 프론트엔드 403/에러 처리 누락 지점 보강

**약점**: `MainPage`/`ChatRoomPage`/`ChatPanel`/`UserProfilePage`의 일부 데이터 fetch(`listMyRooms`, `getRoomMessages`, 상대방 판매 상품 목록)에 `.catch`가 없어, 403이나 네트워크 오류 시 콘솔에 unhandled rejection만 남고 사용자에게는 아무 피드백 없이 빈 화면으로 보일 수 있었다.

**조치**: 각 지점에 `.catch`를 추가해 실패 시 안전한 기본 상태로 폴백하거나(빈 배열/방 없음), `ChatPanel`은 403일 때 "채팅방에 접근할 권한이 없습니다."라는 명확한 인라인 에러 메시지를 표시하도록 수정.

### Low: 프론트엔드가 모든 403을 CSRF 실패로 간주하고 재시도

**약점** (`frontend/src/api/client.ts`): mutating 요청이 403을 받으면 원인과 무관하게 무조건 CSRF 토큰을 재발급받아 1회 재시도했다. 상품 소유권 위반(IDOR 차단)이나 채팅방 접근 권한 없음도 403이므로, 이런 정상적인 인가 실패에도 불필요한 왕복 요청이 발생하고 에러 메시지 표시가 그만큼 지연됐다(보안 구멍은 아니고 UX/효율 문제).

**조치**: 백엔드가 CSRF 실패에만 `code: "CSRF_INVALID"`를 응답 바디에 포함하도록 `HttpError`에 선택적 `code` 필드를 추가하고 `csrf.ts`가 이를 사용하도록 수정(`backend/src/lib/HttpError.ts`, `backend/src/middleware/csrf.ts`, `backend/src/middleware/errorHandler.ts`). 프론트 `api/client.ts`는 이제 응답 바디의 `code === "CSRF_INVALID"`일 때만 토큰을 재발급받아 재시도하고, 그 외 403(IDOR 등)은 즉시 에러로 표면화한다.

**검증**: CSRF 토큰 없이 `PATCH /api/users/me` 호출 시 `{"error":"...","code":"CSRF_INVALID"}` 확인. 반면 소유하지 않은 상품을 유효한 CSRF 토큰으로 수정 시도(IDOR)하면 403이지만 `code` 필드가 없는 `{"error":"본인이 등록한 상품만 수정할 수 있습니다."}`만 반환됨을 확인 — 프론트가 이 경우 재시도하지 않고 바로 에러를 표시함.

### Low: CSRF 토큰 최종 비교가 non-constant-time

**약점** (`backend/src/middleware/csrf.ts`): 쿠키에 저장된 서명(HMAC) 검증은 `crypto.timingSafeEqual`을 쓰지만, 정작 쿠키 토큰과 헤더 토큰을 비교하는 마지막 단계는 일반 문자열 `!==` 비교였다. 토큰이 64자 hex라 실질적 익스플로잇 가능성은 낮지만, 같은 파일 안에서 타이밍 안전성 기준이 일관되지 않는 점을 리뷰에서 지적받음.

**조치**: 헤더/쿠키 토큰을 `Buffer`로 변환 후 `crypto.timingSafeEqual`로 비교하는 `tokensMatch` 헬퍼를 추가(길이가 다르면 조기 반환 후 비교하지 않음 — `timingSafeEqual`은 길이가 다르면 예외를 던지므로).

---

## 검증 완료 항목

- [x] rate limiting 429 응답 실제 트리거 확인 — 동일 IP로 5회 연속 로그인 실패 시 5번째 요청부터 429 확인 (curl 반복 호출).
- [x] 프로덕션 빌드 통과 확인 — `backend: tsc -p tsconfig.json`, `frontend: tsc --noEmit && vite build` 모두 에러 없이 통과.
- [x] `dangerouslySetInnerHTML` 미사용 확인 — `frontend/src` 전체 grep, 실제 사용 코드 없음(주석에서만 언급).
- [x] CSP 헤더가 실제로 응답에 포함되는지 확인 — `curl -I`로 `Content-Security-Policy: default-src 'self'; script-src 'self'; ...` 헤더 수신 확인.
- [x] WebSocket 즉시 무효화(12번) — 연결된 소켓이 신고 임계치 초과 즉시 `io server disconnect`로 끊기는 것을 socket.io-client 스크립트로 확인.
- [x] `startDirectRoom` TOCTOU 수정(12번) — 두 유저가 동시에 8회 요청해도 단일 room으로 수렴, 500 없음을 확인.
- [x] 로그아웃 시 CSRF 쿠키 삭제(12번) — 로그아웃 응답의 `Set-Cookie`에 `tsp.sid`/`tsp.csrf` 둘 다 만료 처리됨을 확인.
- [x] CSRF 실패에만 `code: "CSRF_INVALID"`가 붙는지 확인(12번) — CSRF 누락 요청은 code 포함 403, IDOR 소유권 위반은 code 없는 403으로 서로 다르게 응답됨을 curl로 확인.

## 13. 종합 재검증 (2026-07-11, 민준 지시로 진행)

브라우저 자동화(Playwright/headless Chromium)는 시간 소모가 크고 필수 요구사항이 아니라는 판단에 따라 사용하지 않고,
`curl` + `socket.io-client` 기반 Node 스크립트(`/tmp/.../scratchpad/full_verification.js`, 검증 후 삭제)로
API/WebSocket 레벨에서 아래 세 가지를 재검증했습니다. 백엔드는 로컬 Docker PostgreSQL(`tsp-postgres`)에 연결된
상태로 실제 기동했고, 총 19개 체크 전부 통과했습니다.

### (1) 전체 사용자 플로우

회원가입(판매자) → 로그인(별도 세션으로 재로그인) → 회원가입(구매자) → 상품등록(실제 jpg 파일 첨부, multipart) →
상품상세조회(비로그인 상태) → 전체채팅 메시지 송수신(구매자가 보낸 메시지를 판매자 소켓이 실시간 수신) →
1:1 채팅방 생성 → 양쪽 소켓 `join_room` → 1:1 메시지 송수신(실시간 수신 확인) → REST로 채팅 이력 재조회(DB
저장 확인) → 상품 신고(사유 포함, 201) 순서로 실행. 전 단계 정상 동작 확인(9개 체크 모두 PASS). 상품 상세 응답의
`price`/`name`이 등록 시 값과 정확히 일치하는 것도 함께 확인.

### (2) XSS payload 처리

소개글(`PATCH /api/users/me`), 상품 설명(`PATCH /api/products/:id`), 채팅 메시지(`send_message`) 세 곳 모두에
`<script>alert(1)</script>`를 입력한 뒤:
- API 응답 바디와 DB 재조회 결과가 입력값과 **바이트 단위로 동일**함을 확인(서버가 이스케이프·치환·삭제를 하지 않음 —
  이 프로젝트의 XSS 방어 전략은 "저장은 원본 그대로, 이스케이프는 렌더링 시점에 React가 담당"이므로 이는 의도된 동작).
- `frontend/src` 전체를 다시 grep해 `dangerouslySetInnerHTML` 실사용이 여전히 없음을 재확인(유일한 매치는
  `ChatPanel.tsx`의 "이걸 쓰지 않는다"는 설명 주석 한 줄). 즉 저장된 `<script>` 문자열은 프론트 어디서도 HTML로
  파싱되지 않고 JSX 텍스트 노드로만 렌더링되어 React가 자동 이스케이프한다.
- (참고) 브라우저 실렌더링 육안 확인은 이번 라운드에서 의도적으로 생략(Playwright 등 브라우저 자동화 미사용 지시).
  코드 경로상 `dangerouslySetInnerHTML`이 전무하고 모든 사용자 입력이 JSX 텍스트로만 출력되므로, 렌더링 시점의
  실질 위험은 이미 코드 레벨에서 차단되어 있음.

### (3) 신고 rate limiter (사용자 기준 1시간 20회)

동일 buyer 계정으로 `POST /api/reports`를 짧은 시간에 반복 호출(phase1의 신고 1회 + phase3의 22회 = 총 23회)한
결과, 정확히 **20번째 요청까지는 통과**(첫 요청만 201, 이후는 이미 신고한 대상이라 409)하고 **21번째 요청부터
429**로 차단되는 것을 확인 — `reportLimiter`의 `max: 20`(사용자 ID 기준 keyGenerator) 설정과 정확히 일치.
`skipSuccessfulRequests`가 없으므로 409로 끝난 요청도 카운트에 포함된다는 점까지 실측으로 확인.

**결론**: 세 항목 모두 통과. 코드 수정 없음(순수 검증 라운드).

---

## 14. 실사용 중 발견된 버그 (Windows/PowerShell 환경 리포트)

브라우저 자동화 없이 코드 레벨 분석 + API/소켓 레벨 재현으로 원인을 진단하고 수정했습니다.

### 버그 1: 로그인은 성공하지만 이후 요청이 계속 401

**증상**: 로그인 응답(200)은 정상 수신되어 프론트는 로그인된 것처럼 보이지만, 이후 `GET /api/users/me`,
`GET /api/chat/rooms` 등이 계속 401 — 세션이 실제로는 유지되지 않음.

**원인 분석**: 로그인 요청 자체가 성공했다는 사실(HTTP 200 + 정상 JSON 응답)이 CORS/Origin 불일치 가능성을
사실상 배제한다 — Origin이 허용 목록과 다르면 브라우저가 응답 자체를 fetch 단계에서 차단하므로, 프론트 코드상
`ApiError`가 아닌 일반 `TypeError`로 잡혀 "로그인에 실패했습니다" 배너가 뜨는데, 보고된 증상은 그게 아니었다.
반면 **로그인 POST의 HTTP 레벨 성공 여부와 브라우저의 쿠키 저장 여부는 서로 독립적**이다 — 응답 바디는 정상
수신되어도, `Set-Cookie`에 `Secure` 속성이 붙어 있으면 브라우저는 **HTTPS가 아닌 연결에서는 그 쿠키를 조용히
버린다**(에러도, 콘솔 경고도 없음). 이는 정확히 "로그인은 성공했는데 이후 요청에 세션이 없다"는 증상과 일치한다.
`backend/.env.example`/README는 운영(HTTPS) 환경에서 `COOKIE_SECURE=true`를 설정하라고 안내하는데, 로컬에서도
"보안을 위해" 그대로 켜두거나 프로덕션용 `.env`를 실수로 재사용하면 이 문제가 재현된다 — `session.ts`/`csrf.ts`가
`env.COOKIE_SECURE` 값을 아무 조건 없이 그대로 `secure` 옵션에 넘기고 있어, 이런 설정 실수를 코드가 전혀
방어하지 못했다.

**조치**: `.env`의 `COOKIE_SECURE` 값과 무관하게, **`NODE_ENV`가 실제로 `"production"`일 때만** `Secure`
속성을 적용하도록 변경(`backend/src/env.ts`의 `COOKIE_SECURE_EFFECTIVE` 계산값을 `session.ts`/`middleware/csrf.ts`
양쪽에서 사용). 로컬/개발 환경에서는 `Secure`가 어떤 상황에서도 도움이 되지 않고(HTTPS가 아니므로) 오히려
이런 식으로 인증을 조용히 깨뜨리기만 하므로, `.env` 설정 실수를 코드 레벨에서 원천 차단한 것. 운영 환경에서
`COOKIE_SECURE=true`를 빼먹은 경우엔 반대로 서버 시작 로그에 경고를 출력(`env.ts`). 추가로 서버 기동 시
`[env] cookies: secure=... sameSite=lax; allowed frontend origin(s): ...` 형태로 실제 적용된 쿠키/오리진 설정을
로그로 남기도록 해(`server.ts`), 다음에 비슷한 증상이 재발해도 서버 로그만으로 즉시 원인을 좁힐 수 있게 함.
`FRONTEND_ORIGIN`에 트레일링 슬래시가 붙어 Origin 헤더와 미스매치되는 경우도 함께 방어(문자열 끝 `/` 제거).

**검증**: 로컬(`NODE_ENV=development`)에서 `.env`의 `COOKIE_SECURE`를 의도적으로 `true`로 바꾸고 재기동 →
기동 로그에 `secure=false`로 정정 적용됨을 확인, 실제 `Set-Cookie` 응답 헤더(CSRF/세션 쿠키 둘 다)에
`Secure` 속성이 없음을 curl로 직접 확인(수정 전이었다면 `Secure`가 붙어 실제 브라우저에서 저장되지 않았을
상황). 반대로 `NODE_ENV=production` + `COOKIE_SECURE=true`로 기동 시 로그가 `secure=true`로 정확히 나오는
것도 확인해, 운영 환경에서 의도한 동작이 깨지지 않았음을 함께 검증.

### 버그 2: 사진 첨부 상품등록 시 `net::ERR_CONNECTION_RESET` (서버 프로세스 다운 의심)

**원인 분석**: 클라이언트에서 정상 에러 응답이 아니라 커넥션 자체가 리셋된다는 것은, 그 요청을 처리하던 Node
프로세스가 **응답을 만들기도 전에 죽었다**는 강한 신호다(정상적인 500 에러라면 TCP 연결은 살아있는 채로 응답이
전달된다). 코드 전체를 감사한 결과 실제로 **처리되지 않은 프라미스 거부(unhandled rejection)** 가 발견됨:
`backend/src/socket/index.ts`에서 소켓 연결 시 `void getOrCreateGlobalRoom().then(...)`로 결과만 처리하고
실패(`.catch`)는 처리하지 않고 있었다. Node 15+ 기본 동작상 unhandled rejection은 **프로세스 전체를 강제
종료**시키며, 이 경우 마침 진행 중이던 다른 모든 요청(예: 이미지 업로드)의 TCP 연결도 함께 끊겨
`ERR_CONNECTION_RESET`으로 보이게 된다. 이 경로는 서버 기동 시 `getOrCreateGlobalRoom()`을 미리 호출해
캐시해두므로 평소엔 거의 발동하지 않지만(캐시 히트 시 동기 반환), DB 순단 등 일시적 오류가 겹치면 이 방식대로
전체 프로세스가 죽을 수 있는 잠재적 결함이었다. 추가로 `sharp`의 실제 이미지 디코딩 단계는 별도 `try/catch`
없이 그대로 프로미스 체인에 얹혀 있었는데, 정상적인 프라미스 거부라면 `asyncHandler`가 잡아 500으로
전환하지만, 손상된 파일이나 (특히 Windows처럼) 플랫폼별 네이티브 바이너리 문제 시 발생할 수 있는 예외를 좀 더
명확한 메시지로 안전하게 흡수하는 계층이 없었다. 프로세스 레벨 안전망(`uncaughtException`/`unhandledRejection`
핸들러) 자체도 전무했다.

**조치**:
1. `socket/index.ts`의 `getOrCreateGlobalRoom().then(...)`에 `.catch()`를 추가해 실패해도 해당 소켓에만
   에러 이벤트를 보내고 프로세스는 계속 살아있도록 수정.
2. `backend/src/server.ts`에 `process.on("unhandledRejection", ...)`와 `process.on("uncaughtException", ...)`
   핸들러를 추가. 최초 구현에서는 uncaughtException도 로그만 남기고 계속 서비스하도록 했었는데, 태양 리뷰에서
   "uncaughtException은 예외가 어떤 프레임(DB 커넥션 등)을 뚫고 나왔는지 보장할 수 없는 상태이므로, 계속
   서비스하면 오히려 오염된 상태로 계속 응답할 위험(DB 커넥션 풀 오염 등)이 있다"는 지적을 받고 재작업함 —
   지금은 uncaughtException 발생 시 로그를 남긴 뒤 `httpServer.close()`(진행 중이던 요청은 끝까지 응답)
   → `prisma.$disconnect()` → `process.exit(1)` 순서로 정리 종료하며, 종료가 멈춰버리는 상황(idle
   keep-alive 커넥션 등으로 `close()`가 끝나지 않는 경우)에 대비한 5초 강제종료 타이머를 안전망으로 둔다.
   `unhandledRejection`은 (프라미스 거부는 이런 상태 오염 우려가 없으므로) 로그만 남기고 계속 서비스하는
   기존 방식을 유지. 이 변경으로 **운영 배포 시에는 반드시 프로세스가 죽었을 때 자동으로 재기동해주는
   supervisor(pm2, Docker `restart: unless-stopped`, systemd `Restart=on-failure` 등)가 앞단에 있어야 함** —
   README에 배포 주의사항으로 추가. 진짜 네이티브 모듈 세그폴트는 어느 쪽 핸들러로도 JS 레벨에서 잡을 수
   없다는 한계는 동일하게 남아있음.
3. `backend/src/upload/imageProcessor.ts`의 `sharp` 파이프라인을 `try/catch`로 감싸, 실패 시 스택트레이스를
   서버 로그에만 남기고 클라이언트에는 안전한 422 메시지("이미지 처리 중 오류가 발생했습니다...")로 응답하도록
   변경. sharp가 던지는 원인 불명의 에러가 무엇이든(손상된 파일이든 네이티브 바인딩 문제든) 최소한 프로세스를
   죽이지 않고 정상적인 HTTP 에러로 전환됨을 보장.
4. 서버 기동 시 `checkSharpAvailable()`로 1x1 합성 PNG를 실제로 sharp에 통과시켜보는 self-check을 추가.
   sharp는 OS/아키텍처별 네이티브(libvips) 바이너리를 쓰는데, 이 프로젝트가 서로 다른 머신 간에 공유되는
   네트워크 드라이브 등을 통해 `node_modules`가 통째로 복사·공유된 경우(실사용자가 `F:\` 드라이브에서
   실행했다는 점이 이 가능성을 시사) 네이티브 바인딩이 깨져 있을 수 있는데, 그런 경우 첫 상품 등록 시도에서야
   당황스럽게 발견되는 대신 서버 기동 로그에 바로 원인과 대응 방법("node_modules와 package-lock.json을 지우고
   이 머신에서 직접 `npm install`을 다시 실행하라")을 안내하도록 함.

**검증**:
- 정상 jpg 파일 업로드가 수정 후에도 여전히 201로 정상 처리됨을 확인(회귀 없음).
- 매직바이트 검사는 통과하지만(`FF D8 FF` 헤더) 실제로는 손상된 JPEG 바이트를 업로드해 `sharp`가 디코딩
  단계에서 실제로 예외(`VipsJpeg: Premature end of input file`)를 던지는 상황을 재현 — 이전이었다면 처리
  방식에 따라 위험했을 상황이 이제는 서버 로그에 스택트레이스가 남고 클라이언트에는 422 응답만 반환되며,
  **서버 프로세스는 계속 정상 응답**(`/health` 200)함을 확인.
- 소켓 연결 → 전체채팅방 자동 join → 메시지 송수신까지 `.catch()` 추가 이후에도 정상 동작함을 재확인(회귀 없음).
- graceful shutdown 로직(동일한 close→disconnect→exit 패턴)을 독립된 재현 스크립트로 검증: 처리 중인 요청이 있는
  상태에서 `uncaughtException`을 발생시켰을 때 그 요청이 끝까지 정상 응답된 뒤에야 프로세스가 종료 코드 1로
  종료됨을 확인(강제종료 타이머가 불필요하게 발동하지 않음도 함께 확인).
- (태양 재검토 반영) 채팅이 핵심 기능이라 종료 시점에 열려있는 WebSocket이 흔한데, `httpServer.close()`만으로는
  이미 업그레이드된 소켓 연결이 끊기지 않아 5초 강제종료 타이머가 "예외적 안전망"이 아니라 "매번 타는 경로"가
  될 수 있다는 지적을 받고, `shutdown()` 시작 시 `io.close()`로 소켓을 먼저 정리하도록 추가 — 채팅 유저가 있어도
  대부분 5초를 다 기다리지 않고 종료되도록 개선.
- 서버 기동 로그에 sharp self-check가 정상 통과 시 아무 것도 출력하지 않고(현재 이 검증 환경에서는 sharp가
  정상 동작하므로 조용히 통과), 실패 조건을 인위적으로 만들어보진 않았지만 self-check 함수 자체는 정상 이미지
  처리 경로와 동일한 `sharp()` 호출 패턴을 사용하므로 신뢰 가능.

---

## 검증 환경

로컬 Docker PostgreSQL 컨테이너(`postgres:16-alpine`) + `npx tsx src/server.ts`로 백엔드를 직접 기동하고,
`curl`과 `socket.io-client` 스크립트로 회원가입/로그인/세션/CSRF/상품 CRUD/파일 업로드/신고 임계치/IDOR/Socket.IO 인증 및
실시간 메시지 송수신까지 REST + WebSocket 양쪽 경로를 실제로 호출하며 확인했습니다(브라우저 UI 자동화 없이 API 레벨 검증).

---

## 15. v1.2 확장 — 송금(포인트), 상품 검색, 관리자 기능

민준이 `docs/architecture.md`에 v1.2로 추가한 §7(송금)/§8(검색)/§9(관리자) 설계를 §10 순서(마이그레이션 →
송금 → 검색 → 관리자)대로 구현했습니다. 이 섹션은 완료 후 한 번에 정리한 게 아니라, "구현 → 자체 검증 →
태양 리뷰 → (지적사항 있으면) 수정 → 재검증 → 재검토" 사이클을 반복하며 그때그때 누적한 기록입니다.

### 15.1 구현 요약

- **DB**: `wallets`(1:1, `balance BIGINT CHECK(balance >= 0)`), `transfers`(불변 원장,
  `CHECK(amount > 0)`, `CHECK(sender_id <> receiver_id)`, `UNIQUE(sender_id, idempotency_key)`) 신규 테이블.
  `users.role`(`ENUM('user','admin')`, 기본값 `user`), `reports.resolved/resolved_at/resolved_by` 컬럼 추가.
  Prisma는 CHECK 제약 DSL이 없어 마이그레이션 SQL에 수기로 추가(`backend/prisma/migrations/.../migration.sql`).
  기존 유저에도 지갑을 백필하는 `INSERT ... ON CONFLICT DO NOTHING`을 같은 마이그레이션에 포함.
- **송금**: `backend/src/services/wallet.service.ts`. 조건부 `updateMany(WHERE balance >= amount)`로
  잔액 부족을 트랜잭션 내부에서 원자적으로 검증(§7.2), sender/receiver 지갑 행을 **항상 id 정렬 순서로** 갱신해
  데드락을 구조적으로 방지(`chat_rooms`의 `user_id_low/high` 패턴 재사용), Postgres 데드락(Prisma `P2034`)
  감지 시 1회 재시도. 멱등키는 `(senderId, idempotencyKey)` 사전 조회 + `UNIQUE` 제약 위반(P2002) 시
  재조회-후-반환으로 이중 방어(`startDirectRoom`과 동일 패턴). 회원가입 트랜잭션에 지갑 생성(`SIGNUP_BONUS_POINTS`,
  기본 10000P)을 포함해 "지갑 없는 유저" 상태 자체가 존재하지 않도록 함.
- **검색**: 기존 `GET /api/products`에 `search` 쿼리 파라미터만 추가(`product.service.ts`), `name`/`description`에
  대한 Prisma `contains`(`mode: 'insensitive'`) — 파라미터 바인딩되므로 SQLi 위험 없음(§6과 동일 원칙). 목록
  최소노출 원칙(id+name만)은 검색 결과에도 그대로 적용.
- **관리자**: `requireAdmin`(`backend/src/middleware/admin.ts`)은 `requireAuth`가 이미 채워둔 `req.currentUser`의
  `role`만 검사 — 추가 쿼리 없음. 관리자 승격은 공개 API 어디에도 없고 `backend/scripts/promoteAdmin.ts`(운영자가
  서버에서 직접 실행하는 CLI)로만 가능. 회원가입 요청 바디에 `role`을 넣어도 Zod 스키마에 그 필드 자체가 없어
  무시됨(실제로 `role: "admin"`을 넣어 회원가입해도 결과가 `user`임을 확인 — 15.2 참고). 관리자의 상품 강제
  삭제는 일반 삭제(`product.service.ts`)와 별개 함수(`admin.service.ts`)로 구현해 소유권 검증 코드를 공유하지
  않음(설계 의도 그대로).
- **BigInt 직렬화**: `wallets.balance`/`transfers.amount` 등은 Prisma에서 JS `bigint`로 매핑되는데 `bigint`는
  `JSON.stringify`가 던지므로, 모든 응답 DTO에서 문자열로 변환(`serializeSelfUser`, `wallet.service.ts`의
  `serializeTransfer`) — 정밀도 손실 없는 표준적인 처리 방식.

### 15.2 검증 사이클

#### Cycle 1 (자체 검증, 태양 리뷰 요청 전)

**일반 동작 확인** (`node` + `fetch` 스크립트, 서버 실기동 상태):
- 회원가입 시 `SIGNUP_BONUS_POINTS`(10000) 자동 지급 확인, `role`을 요청 바디에 넣어도 무시되고 `user`로
  생성됨을 확인.
- 정상 송금(A→B 3000) → 양쪽 잔액 정확히 반영, 응답에 `senderBalanceAfter`/`receiverBalanceAfter` 스냅샷 포함.
- 동일 `idempotencyKey`로 재요청 시 새 송금이 발생하지 않고 최초 결과가 그대로 반환됨(잔액 재확인으로 이중
  차감 없음 확인).
- `MAX_TRANSFER_AMOUNT` 초과 금액은 Zod 검증 단계에서 400.
- 상품 검색: 상품명 매칭/설명 매칭/무매칭/검색어 없을 때(기존 동작 유지) 4가지 케이스 모두 정상.
- DB 레벨 CHECK 제약 직접 확인: `UPDATE wallets SET balance = -100 ...`을 애플리케이션 우회해서 직접 실행 →
  `wallets_balance_non_negative` 제약 위반으로 즉시 거부됨을 확인(애플리케이션 로직에 버그가 있어도 DB가
  최종 방어선이라는 설계 의도가 실제로 동작함을 증명).
- 관리자 전체 기능(유저 강제휴면/휴면해제+reportCount 리셋, 상품 전체목록(전체필드)/강제삭제/차단해제, 신고
  목록(target 조인)/처리완료 표시, 전체 송금내역 필터 조회) 14개 체크 전부 통과.

**필수 지정 엣지케이스 재현** (`test_edge_cases.js`, 20개 체크 전부 통과):

| # | 시나리오 | 재현 방법 | 결과 |
|---|---|---|---|
| 1 | 동시 송금 레이스(잔액 10000에 6000+6000 동시 요청) | `Promise.all`로 병렬 fetch 2건 | 정확히 하나만 200, 하나는 409. 최종 잔액 4000(송신)/16000(수신) — 이중차감·잔액꼬임 없음 |
| 2 | 잔액 초과 송금(단건 + 동시 3건) | 999999P 송금 시도 | 전부 409, 잔액 불변, 음수 발생 없음 |
| 3 | 자기 자신 송금 | `receiverId === senderId`로 요청 | 400, 잔액 불변 |
| 4 | 관리자 라우트 권한 우회 | 일반 유저 세션으로 `/api/admin/*` 9개 엔드포인트(유저 2, 상품 3, 신고 2, 송금내역 1 + 목록) 전부 직접 호출 | 전부 403. 대조군으로 실제 관리자 세션으로는 200임을 함께 확인(테스트 자체의 오탐 아님을 검증) |

이전 라운드(§13 이전 커밋)에서 이미 확인한 동시 반대방향 송금(A→B, B→A 16건 동시) 데드락 없음 테스트도
함께 재확인(회귀 없음).

**정적 검증**: `backend`/`frontend` 양쪽 `tsc --noEmit` 및 프로덕션 빌드 모두 통과.

#### 태양 리뷰 (Cycle 1) — 결과: 병합 가능

태양이 서연의 보고를 그대로 신뢰하지 않고, 로컬에 서버를 직접 띄워 **독립적으로 동일 위협을 재현**하는
방식으로 검토했습니다(전체 기록은 `docs/review.md` "v1.2 확장 리뷰(송금/검색/관리자) — Cycle 1" 참고).
중점 요청 4가지(동시성 안전/BigInt 직렬화/관리자 권한 즉시반영/삭제로직 분리) 전부 코드 리딩 + 독립
재현으로 확인했고, 추가로:

- 관리자 세션으로 로그인한 뒤 **같은 세션 쿠키를 그대로 둔 채** DB에서 `role`을 직접 `admin → user`로
  강등시키고, 재로그인 없이 그 쿠키로 `/api/admin/users` 호출 시 즉시 403이 되는 것을 확인 — "다음 요청부터
  즉시 반영"이 실제로 그렇다는 것을 승격이 아닌 **강등** 방향으로도 검증(서연의 자체 검증에는 없던 각도).
- `wallets_balance_non_negative` CHECK 제약을 `$executeRawUnsafe`로 애플리케이션을 완전히 우회해 직접
  깨보려는 시도 → Postgres `23514`(check_violation)로 거부, 잔액 불변까지 실제 에러로 확인.
- `PUBLIC_USER_SELECT`/관리자 조회 함수들 모두 `wallet` 필드 자체를 select하지 않아, 직렬화 누락 여부와
  무관하게 애초에 타인 잔액이 응답에 노출될 수 없는 구조라는 점도 확인.

**비블로커 제안**: 검증 스크립트(`test_edge_cases.js`)가 저장소에 없어 태양이 매번 새로 스크립트를 짜야
했던 점을 지적받음 → `backend/scripts/verifyWalletAdminEdgeCases.js`로 정리해 커밋(`npm run
verify:wallet-admin --workspace backend`, 관리자 대조군 확인은 `VERIFY_ADMIN_USERNAME`/`VERIFY_ADMIN_PASSWORD`
설정 시에만 실행되고 미설정 시 안전하게 스킵됨). 커밋 직후 재실행해 20개 체크 전부 통과를 재확인.

**최종 결론(태양)**: "현재 diff는 병합 가능한 상태로 판단합니다." — 추가 지적사항 없음, 별도 Cycle 2 불필요.

---

## 16. Sprint 3 사전 전 기능 E2E 회귀 검증 (2026-07-13, `refactor/agile-v2`)

대규모 리팩토링(라우트/서비스 분리, 공용 `lib/pagination.ts` 커서 헬퍼 도입 등) 직후라 Sprint 3 착수 전에
전 기능 회귀 여부를 실서버(E2E) 기준으로 재확인했습니다. 지갑/관리자 엣지케이스는 같은 날
`verifyWalletAdminEdgeCases.js` 20/20 통과를 별도로 확인했으므로 이 검증에서는 제외했습니다.

**검증 스크립트**: `backend/scripts/verifyFullE2E.js` (신규, 수동 실행용 — `node
backend/scripts/verifyFullE2E.js`, dev 서버 실기동 + Postgres 필요). 테스트 계정은 실행마다 유니크한
suffix로 생성되어 재실행 가능. 주의: `authLimiter`가 IP당 15분에 실패 5회를 허용하는데 이 스크립트가
회당 의도적 실패 3회(중복가입 409, 오답 로그인 401, 없는 아이디 401)를 만들므로, 15분 내 반복 실행 시
음성 케이스가 429로 뜰 수 있음(회귀 아님 — 스크립트가 429를 별도 표기).

**결과: 44개 체크 전부 통과 (`=== RESULT: 44 passed, 0 failed ===`), 회귀 0건. 서버 로그에도 unhandled
error 없음.**

| 영역 | 확인한 것 | 결과 |
|---|---|---|
| 인증 | 가입 201 → 중복 아이디 409 → 로그아웃 204(Set-Cookie로 `tsp.sid`/`tsp.csrf` 둘 다 1970 만료 확인) → 재로그인 → `/api/users/me` 200. 오답 비밀번호와 없는 아이디가 동일한 401 + **동일 에러 메시지**(계정 열거 방지 유지) | 11/11 |
| CSRF | 세션 쿠키만 있고 `x-csrf-token` 없는 POST → 403 + `code: "CSRF_INVALID"` | 1/1 |
| 상품 | multipart(실 PNG) 등록 201 → sharp 재인코딩으로 `.jpg` 저장 + `/uploads/products/*` 서빙(image/jpeg) → 목록 노출(최소노출 id+name 유지) → 상세 → 본인 수정 200 → **타 계정 PATCH 403(IDOR, CSRF 403과 구분됨) + 데이터 불변** → `search=` 매칭/무매칭 → **limit=1 커서 페이지네이션**(nextCursor=마지막 항목 id, 2페이지 무중복, 마지막 페이지 null — 리팩토링된 `lib/pagination.ts` 검증) → 삭제 204 + 상세 404 | 19/19 |
| 채팅 | 1:1 방 생성 201 → 같은 pair 재요청 시 동일 room id(멱등) → 세션 쿠키만으로 Socket.IO 인증 연결 → `join_room`/`send_message` ack → 상대 실시간 수신(sender 서버 재유도 확인) → REST 히스토리 일치 | 7/7 |
| 신고/휴면 | 신고자 3명(USER_REPORT_THRESHOLD=3) → 대상 REST 즉시 401 → **살아있는 Socket.IO 연결이 `io server disconnect` 사유로 서버에 의해 강제 종료**(리뷰 C-1 회귀 없음) → 동일 신고자 재신고 409(`@@unique([reporterId, targetType, targetId])`) | 5/5 |
| 헬스체크 | `/health` 200 `{ok:true}`, `/health/ready` 200 `{status:"ready"}` | 2/2 |

검색 파라미터는 §15에 기록한 대로 `search=`가 계약입니다(구두로 `q=`로 불리곤 하는데, API·프론트 모두
`search`를 사용 — 이번 검증도 `search=` 기준).

**결론**: refactor/agile-v2 리팩토링으로 인한 기능/보안 회귀 없음. Sprint 3 착수 가능.
