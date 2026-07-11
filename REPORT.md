# 보안 구현 리포트

작성자: 서연 (개발자)
상태: 코드 리뷰(태양) 1차 반영 완료

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

## 남은 검증 (프론트엔드 화면 완성 후 진행 권장)

- [ ] 실제 브라우저로 채팅/상품설명에 `<script>` payload를 입력해 렌더링 결과 육안 확인 (React 이스케이프 특성상 코드 레벨로는 이미 안전하나, 최종 수동 확인 권장)
- [ ] 신고 rate limiter(사용자 기준 1시간 20회) 트리거 확인 — 임계치가 높아 로컬에서 반복 호출로 재현 필요

## 검증 환경

로컬 Docker PostgreSQL 컨테이너(`postgres:16-alpine`) + `npx tsx src/server.ts`로 백엔드를 직접 기동하고,
`curl`과 `socket.io-client` 스크립트로 회원가입/로그인/세션/CSRF/상품 CRUD/파일 업로드/신고 임계치/IDOR/Socket.IO 인증 및
실시간 메시지 송수신까지 REST + WebSocket 양쪽 경로를 실제로 호출하며 확인했습니다(브라우저 UI 자동화 없이 API 레벨 검증).
