# Tiny Second-hand Shopping Platform — 설계 문서

작성자: 민준 (아키텍트)
버전: v1.2 (변경 이력: v1.0 초기 설계 / v1.1 WebSocket 즉시 무효화 보강 — §5 / v1.2 송금·상품검색·관리자 기능 확장 — §7~§10)

## 0. 최소 기능 요구사항 (MVP)

- 회원가입 / 로그인 / 프로필 조회 / 마이페이지(소개글·비밀번호 수정)
- 상품 등록 / 내 상품 관리 / 전체 조회(목록엔 이름만) / 상세 페이지
- 실시간 전체채팅 + 1:1 채팅
- 상품/유저 신고(사유 필수) + 일정 횟수 이상 시 상품 자동 차단 / 유저 휴면 전환

**v1.2 확장 요구사항** (강의자료 기준 추가, 기존 기능 유지)
- 유저 간 송금(포인트/캐시)
- 상품 검색(상품명 기준)
- 관리자(admin) 기능

---

## 1. 기술스택 선정

| 영역 | 선택 | 이유 |
|---|---|---|
| 프론트엔드 | React + TypeScript (Vite) | 컴포넌트 단위 개발로 상품목록/상세/채팅 UI 분리가 쉬움. 실시간 채팅처럼 상태가 자주 바뀌는 화면에서 타입 안정성이 버그를 줄여줌. 소규모 프로젝트이므로 Next.js 같은 풀스택 프레임워크의 SSR 복잡도는 불필요하다고 판단 |
| 백엔드 | Node.js + Express + TypeScript | 프론트와 언어 통일(TS)로 협업 비용 감소. REST API와 WebSocket 서버를 같은 프로세스/언어로 운영할 수 있어 아키텍처가 단순해짐 |
| DB | PostgreSQL | 사용자-상품-신고-채팅 간 FK 관계가 명확한 관계형 데이터. 신고 임계치 도달 시 상태 전이(active→blocked/dormant)를 트랜잭션으로 원자적으로 처리해야 하므로 ACID가 필요한 RDBMS 선택. SQLite는 동시 쓰기(채팅)에 취약해서 제외 |
| ORM | Prisma | 타입 안전한 쿼리 + 마이그레이션 관리로 개발자가 스키마 변경을 안전하게 반영 가능. Raw SQL 조합을 줄여 SQL Injection 표면 자체를 축소 |
| 실시간 채팅 | Socket.IO (WebSocket, polling fallback) | 방(room) 단위 브로드캐스트가 내장되어 있어 "전체채팅방 1개 + 1:1채팅방 N개" 구조를 room 개념으로 그대로 매핑 가능. 재연결/네트워크 불안정 시 자동 재접속과 polling fallback을 자체 제공해 순수 ws 라이브러리 대비 구현 비용이 낮음. Express와 같은 HTTP 서버를 공유해 인증 미들웨어 재사용 가능 |
| 비밀번호 해싱 | bcrypt | 업계 표준, salt 자동 처리, cost factor 조절로 브루트포스 비용 조절 가능 |
| 파일 저장 | 로컬 디스크(`/uploads`) + `sharp` 재인코딩 | 초기 규모에서는 로컬 저장으로 충분. 이미지 재인코딩으로 악성 폴리글랏 파일/EXIF 메타데이터 제거(6장 참고). 트래픽 증가 시 S3 호환 스토리지로 교체 가능하도록 파일 접근을 서비스 레이어로 추상화 |
| 입력 검증 | Zod | 모든 API 요청 바디/쿼리를 스키마로 검증, 백엔드/프론트 스키마 공유 가능 |

---

## 2. 시스템 아키텍처

```
┌─────────────────────┐
│   React SPA (TS)     │
│  - REST 호출(fetch)   │
│  - Socket.IO client   │
└─────────┬────────────┘
          │ HTTPS (REST, 쿠키 포함)
          │ WSS (Socket.IO handshake, 쿠키 포함)
          ▼
┌──────────────────────────────────────────────┐
│           Node.js / Express (TS)               │
│                                                  │
│  [Middleware 체인]                              │
│  helmet → cors → session → csrf(mutating only)  │
│  → rate limiter → 라우터                         │
│                                                  │
│  [REST Layer]        [Socket.IO Layer]          │
│  Controller           handshake 인증(세션쿠키)     │
│    ↓                  join_room / send_message  │
│  Service (비즈니스로직, 신고 임계치 판정 등)         │
│    ↓                                            │
│  Repository (Prisma)                            │
└───────────────┬──────────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
  PostgreSQL         로컬 파일스토리지(/uploads)
  (users/products/    (상품 이미지)
   reports/chat_*)
```

- REST API: 회원/상품/신고/채팅 이력(과거 메시지 조회) 처리
- Socket.IO: 실시간 메시지 송수신만 담당 (메시지는 저장 후 브로드캐스트)
- Service 레이어에 "신고 카운트 증가 → 임계치 도달 시 상태 전이"를 하나의 DB 트랜잭션으로 처리하는 로직 집중 (동시 신고로 인한 race condition 방지)
- 휴면 전환된 사용자는 다음 요청 시 세션 검증 단계에서 즉시 차단(§5 참고)

---

## 3. DB 스키마 설계

기본 원칙: 모든 PK는 UUID(v4) 사용 — 순차 정수 ID 노출 시 발생하는 열거(enumeration) 공격 표면을 줄이기 위함(IDOR 방어의 보조 수단, §6에서 상세).

### users
| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | UUID | PK |
| username | VARCHAR(30) | UNIQUE, NOT NULL |
| password_hash | VARCHAR(60) | NOT NULL (bcrypt) |
| bio | TEXT | NULL 허용 |
| status | ENUM('active','dormant') | NOT NULL, DEFAULT 'active' |
| report_count | INT | NOT NULL, DEFAULT 0 |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### products
| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | UUID | PK |
| name | VARCHAR(100) | NOT NULL |
| description | TEXT | NOT NULL |
| price | INT | NOT NULL, CHECK(price >= 0) |
| seller_id | UUID | FK → users.id, NOT NULL |
| status | ENUM('active','blocked') | NOT NULL, DEFAULT 'active' |
| report_count | INT | NOT NULL, DEFAULT 0 |
| image_path | VARCHAR(255) | NULL 허용 (서버 생성 UUID 파일명만 저장) |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### reports
| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | UUID | PK |
| reporter_id | UUID | FK → users.id, NOT NULL |
| target_type | ENUM('user','product') | NOT NULL |
| target_id | UUID | NOT NULL (polymorphic — 아래 참고) |
| reason | TEXT | NOT NULL (빈 문자열 금지, 앱 레벨 검증) |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**설계 노트 — polymorphic target**: `target_id`는 `target_type`에 따라 users 또는 products를 가리키므로 DB 레벨 FK 제약을 걸 수 없다(요구 스키마 유지 위해 단일 reports 테이블 사용). 대신:
- 애플리케이션 서비스 레이어에서 신고 생성 시 target 존재 여부를 조회로 검증
- **`UNIQUE(reporter_id, target_type, target_id)`** 제약 추가 — 동일 사용자가 같은 대상을 반복 신고해 카운트를 조작(어뷰징)하는 것을 원천 차단. 신고 임계치는 "distinct 신고자 수"와 사실상 동일해짐

### 채팅 테이블

**chat_rooms**
| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | UUID | PK |
| type | ENUM('global','direct') | NOT NULL |
| created_at | TIMESTAMPTZ | DEFAULT now() |

- `type='global'` 방은 시스템 시딩 시 단 1개만 생성 (전체채팅방)
- `type='direct'` 방은 두 사용자 간 최초 대화 시작 시 생성

**chat_room_participants**
| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | UUID | PK |
| room_id | UUID | FK → chat_rooms.id, NOT NULL |
| user_id | UUID | FK → users.id, NOT NULL |
| joined_at | TIMESTAMPTZ | DEFAULT now() |

- `UNIQUE(room_id, user_id)` — 중복 참여 방지
- direct 방은 정확히 2개 row. **`UNIQUE(user_id_low, user_id_high)`** 형태의 보조 유니크 인덱스(정렬된 두 user_id 쌍)를 별도로 두어 동일한 두 사용자 간 direct 방이 중복 생성되지 않도록 함
- global 방은 참여자를 별도로 관리하지 않고(모든 active 사용자가 암묵적 참여자), 소켓 연결 시 자동 join

**messages**
| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | UUID | PK |
| room_id | UUID | FK → chat_rooms.id, NOT NULL |
| sender_id | UUID | FK → users.id, NOT NULL |
| content | TEXT | NOT NULL |
| created_at | TIMESTAMPTZ | DEFAULT now() |

인덱스: `(room_id, created_at)` — 방별 메시지 페이징 조회 최적화.

---

## 4. API 엔드포인트 설계 (REST)

인증 필요 여부: 🔒 = 로그인 필요, 🔓 = 공개

```
[인증]
POST   /api/auth/signup            🔓  회원가입
POST   /api/auth/login             🔓  로그인 (세션 쿠키 발급)
POST   /api/auth/logout            🔒  로그아웃 (세션 파기)

[사용자]
GET    /api/users/me               🔒  내 정보(마이페이지)
PATCH  /api/users/me                🔒  소개글(bio) 수정
PATCH  /api/users/me/password       🔒  비밀번호 수정 (현재 비밀번호 확인 필수)
GET    /api/users/:id               🔓  공개 프로필 조회 (username, bio만; password_hash/report_count 등 비공개 필드 제외)

[상품]
POST   /api/products                🔒  상품 등록 (multipart/form-data, 이미지 포함)
GET    /api/products                🔓  전체 상품 목록 (id, name만 반환 — 목록 최소 노출 원칙)
GET    /api/products/:id            🔓  상품 상세 (전체 필드, 단 status='blocked'면 판매자 본인 외 404)
GET    /api/products/mine           🔒  내 상품 관리 목록 (본인 소유만, status 무관 전체 표시)
PATCH  /api/products/:id            🔒  내 상품 수정 (seller_id 소유 검증)
DELETE /api/products/:id            🔒  내 상품 삭제 (seller_id 소유 검증)

[신고]
POST   /api/reports                 🔒  신고 생성 { target_type, target_id, reason }
                                         → 서비스 레이어에서 report_count 증가 및 임계치 판정

[채팅 - 이력/방 관리, 실시간 송수신은 WebSocket]
GET    /api/chat/rooms              🔒  내가 속한 채팅방 목록 (global + 내 direct 방들)
GET    /api/chat/rooms/:id/messages 🔒  방 메시지 이력 조회 (참여자 검증, 페이징: ?before=&limit=)
POST   /api/chat/rooms/direct       🔒  { targetUserId } → 기존 direct 방 반환 또는 신규 생성
```

### WebSocket (Socket.IO) 이벤트

```
[연결]
connection            handshake 시 세션 쿠키로 인증 → 실패 시 연결 거부
                       연결 성공 시 서버가 자동으로 global room에 join

[클라이언트 → 서버]
join_room     { roomId }        1:1 채팅방 입장 (참여자 검증)
send_message  { roomId, content }  메시지 전송 (서버가 저장 후 브로드캐스트)

[서버 → 클라이언트]
receive_message { roomId, senderId, content, createdAt }
error            { code, message }
```

메시지는 반드시 서버에서 `messages` 테이블에 저장한 뒤 room 내 참여자에게 브로드캐스트 (클라이언트 신뢰 금지, sender_id는 소켓 인증 세션에서 서버가 채움).

---

## 5. 인증/세션 구조

**선택: 세션 기반 인증 + httpOnly, Secure, SameSite=Lax 쿠키** (JWT 미채택)

이유:
1. **즉시 무효화(revocation) 필요성** — 이 서비스의 핵심 요구사항 중 하나가 "신고 누적 시 유저 휴면 전환"이다. 휴면 전환은 곧바로 해당 사용자의 접근 권한을 박탈해야 하는데, JWT는 만료 전까지 서버가 강제로 무효화할 방법이 없어(블랙리스트를 별도로 운영해야 하며, 이는 결국 세션 저장소를 흉내 내는 것) 세션 방식이 요구사항에 더 직접적으로 부합한다.
2. 세션 데이터(사용자 status 등)를 서버가 소유하므로, 매 요청마다 세션 조회 시 최신 status를 확인해 휴면 사용자를 차단하는 로직을 단순하게 구현 가능.
3. httpOnly 쿠키는 JS에서 접근 불가능해 XSS로 인한 토큰 탈취 위험이 JWT를 localStorage에 저장하는 방식보다 낮음.
4. 트레이드오프로 CSRF 방어가 추가로 필요하지만(§6), SameSite=Lax + CSRF 토큰으로 충분히 방어 가능한 수준이며, 이 프로젝트 규모에서 JWT의 수평 확장 이점(stateless)은 우선순위가 낮다고 판단.

**구현 방식**
- 세션 저장소: 초기 규모에서는 PostgreSQL 세션 테이블(`connect-pg-simple` 방식)로 별도 인프라(Redis) 없이 구현. 트래픽 증가 시 Redis로 교체 가능하도록 세션 스토어를 추상화.
- 쿠키 속성: `httpOnly; Secure; SameSite=Lax; Path=/`, 만료 예: 7일 (rolling expiration)
- 로그인 성공 시 세션에 `userId`만 저장(민감정보 최소화), 매 요청마다 DB에서 최신 `status`를 조회해 `dormant`면 401 반환 + 세션 파기
- 비밀번호 변경 시 다른 기기의 세션은 유지할지 정책 결정 필요 — 기본값은 "현재 세션 제외 전체 파기" 권장(선택 사항, 개발자와 협의)
- WebSocket 인증: Socket.IO handshake 시 브라우저가 자동 전송하는 세션 쿠키를 서버가 파싱해 동일한 세션 검증 로직 재사용 (별도 토큰 발급 불필요)

**WebSocket 연결의 "즉시 무효화" 보강 (설계 수정, v1.1)**

세션 방식을 선택한 핵심 근거가 "즉시 무효화"인데, Socket.IO 연결은 REST 요청과 달리 **handshake 시 1회만 인증되고 이후 오래 유지**된다. handshake 통과 후 이미 연결된 소켓은 그 뒤 해당 유저가 신고 누적으로 `dormant` 전환되어도 세션/DB 재조회 없이 계속 메시지를 주고받을 수 있어, §5의 "즉시 무효화" 전제가 REST에는 성립하지만 **WebSocket에는 성립하지 않는 설계 공백**이 있었다. 이를 다음과 같이 보강한다.

- 연결(connection) 시 인증된 소켓을 전역 room뿐 아니라 **개인 room `user:{userId}`**에도 join시킨다.
- `report.service.ts`의 신고 트랜잭션에서 유저를 `dormant`로 전환하는 시점(§3/§6의 신고 자동 처리 트랜잭션 커밋 직후)에, REST 서비스 레이어가 Socket.IO 서버(`io`)를 직접 참조하지 않도록 **도메인 이벤트(Node `EventEmitter`) 로 `user:dormant { userId }`를 발행**한다. REST 서비스 계층과 소켓 계층의 결합도를 낮추기 위함(서비스 레이어는 실시간 전송 계층의 존재를 몰라야 함).
- 소켓 계층은 이 이벤트를 구독해 `io.in('user:' + userId).disconnectSockets(true)`로 해당 유저의 모든 연결을 즉시 강제 종료한다. 클라이언트는 강제 종료를 감지해 로그인 페이지로 리다이렉트한다.
- 이렇게 하면 매 메시지마다 DB를 재조회하는 폴링 방식(불필요한 오버헤드) 대신, 상태 전이가 발생하는 그 순간에만 푸시 방식으로 무효화하여 §5의 "즉시 무효화" 원칙이 REST/WebSocket 양쪽에서 실제로 성립한다.
- (참고) 이 메커니즘은 단일 프로세스 전제다. 향후 서버를 다중 인스턴스로 확장하면 `EventEmitter`를 Redis Pub/Sub(Socket.IO Redis adapter)로 교체해야 인스턴스 간 강제 종료 이벤트가 전파된다 — 지금 범위에서는 과설계이므로 명시만 해둔다.

---

## 6. 보안 설계 원칙

| 위협 | 방어 방식 |
|---|---|
| **SQL Injection** | Prisma ORM으로 모든 쿼리를 파라미터화. Raw SQL은 원칙적으로 금지하고, 불가피한 경우 Prisma의 `$queryRaw` 태그드 템플릿(자동 파라미터 바인딩)만 허용, 문자열 concat으로 쿼리 조립 금지 |
| **XSS** | React는 기본적으로 텍스트를 이스케이프하므로 `dangerouslySetInnerHTML` 사용 금지를 코딩 규칙으로 명시. 사용자 입력값(bio, 상품 설명, 채팅 메시지)은 HTML/마크다운 렌더링을 지원하지 않고 순수 텍스트로만 표시. 응답 헤더에 `Content-Security-Policy`(script-src 'self') 적용해 인라인 스크립트 실행 자체를 차단 |
| **CSRF** | 세션 쿠키 `SameSite=Lax`가 1차 방어. 여기에 더해 상태 변경 요청(POST/PATCH/DELETE)에는 Double Submit Cookie 방식의 CSRF 토큰을 요구(로그인 시 발급, 커스텀 헤더 `X-CSRF-Token`으로 전송). GET 요청은 부수효과 없는 순수 조회만 허용 |
| **IDOR** | 모든 리소스 접근에 Service 레이어에서 소유권/권한 검증을 강제 (예: `PATCH /products/:id`는 `product.seller_id === session.userId` 확인 후에만 처리). PK를 UUID로 채택해 순차 ID 추측을 통한 무차별 열거를 어렵게 함(단, 이는 보조 수단일 뿐 주 방어는 항상 권한 검증). `blocked` 상품/`dormant` 유저의 상세 정보는 본인 또는 관리자 외 접근 시 403/404로 존재 자체를 숨김 |
| **파일 업로드 검증** | (1) 확장자·MIME 화이트리스트: jpg/png/webp만 허용 (2) Content-Type 헤더는 신뢰하지 않고 파일 시그니처(magic byte)를 라이브러리로 직접 검사 (3) 파일 크기 제한(예: 5MB) (4) 업로드 파일명은 클라이언트 값을 절대 사용하지 않고 서버가 UUID로 재생성 (5) `sharp`로 이미지를 재인코딩해 저장 — 원본 바이트를 그대로 저장하지 않음으로써 EXIF 메타데이터 제거 및 이미지로 위장한 폴리글랏 파일(스크립트 삽입 등) 무력화 (6) 업로드 디렉터리는 실행 권한 없는 정적 파일 서빙 경로로만 접근 가능하도록 구성 |
| **Rate Limiting** | `express-rate-limit` 적용: (1) 로그인/회원가입 엔드포인트에 IP 기준 강한 제한(예: 5회/분)으로 브루트포스·계정 대량 생성 방지 (2) 신고 생성 엔드포인트에 사용자 기준 제한 — 신고 자동 차단/휴면 로직이 존재하므로, 이 엔드포인트가 어뷰징되면 정상 사용자/상품이 악의적으로 차단될 수 있어 특히 중요 (3) 전역 API에도 완만한 기본 제한 적용 |
| **신고 어뷰징 방지(보강)** | §3의 `UNIQUE(reporter_id, target_type, target_id)` 제약으로 동일인 반복 신고 차단. 임계치 판정은 반드시 서버 트랜잭션 내에서 "신고 row 삽입 + report_count 증가 + 임계치 초과 시 status 변경"을 원자적으로 수행해 동시 신고에 의한 race condition으로 카운트가 누락/중복되지 않도록 함 |
| **비밀번호 저장** | bcrypt (cost factor 12 권장), 평문/가역 암호화 저장 금지 |
| **전송 구간 암호화** | HTTPS 강제(HSTS 헤더), Secure 쿠키 플래그는 HTTPS 환경 전제 |
| **보안 헤더 일반** | `helmet` 미들웨어로 CSP, X-Content-Type-Options, X-Frame-Options 등 기본 적용 |
| **입력 검증** | 모든 REST 엔드포인트에 Zod 스키마로 요청 바디/쿼리 검증 후 컨트롤러 진입, 스키마 미통과 시 400 반환 |

---

## 7. [v1.2] 유저 간 송금 (포인트/캐시)

사실상 미니 결제 시스템이므로 신고 자동 차단 로직(§3/§6)보다 훨씬 엄격한 동시성·원자성 보장이 필요하다. 아래 설계는 "잔액이 음수가 되거나, 요청이 두 번 처리되거나, 감사 추적이 불가능해지는" 세 가지 실패 모드를 막는 데 초점을 둔다.

### 7.1 DB 스키마

**wallets** (users와 1:1, 별도 테이블로 분리)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → users.id, **UNIQUE**, NOT NULL |
| balance | BIGINT | NOT NULL, DEFAULT 0, **CHECK(balance >= 0)** |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

**설계 노트 — users에 컬럼 추가가 아니라 별도 테이블을 선택한 이유**: `users` 행은 bio 수정, 비밀번호 변경, 휴면 전환 등 잔액과 무관한 이유로도 자주 갱신된다. 잔액을 `users.balance`로 두면 송금 트랜잭션의 행 잠금이 이런 무관한 업데이트와 불필요하게 경합한다. 지갑을 분리하면 송금 트랜잭션의 잠금 범위가 "돈이 실제로 오가는 행"으로 좁아진다.

**transfers** (불변 원장 / ledger — UPDATE·DELETE 없이 INSERT만 발생)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | UUID | PK |
| sender_id | UUID | FK → users.id, NOT NULL |
| receiver_id | UUID | FK → users.id, NOT NULL |
| amount | BIGINT | NOT NULL, CHECK(amount > 0) |
| idempotency_key | VARCHAR(100) | NOT NULL |
| sender_balance_after | BIGINT | NOT NULL (감사용 스냅샷) |
| receiver_balance_after | BIGINT | NOT NULL (감사용 스냅샷) |
| created_at | TIMESTAMPTZ | DEFAULT now() |

- `CHECK(sender_id <> receiver_id)` — 자기 자신 송금을 DB 레벨에서도 차단(앱 레벨 검증의 defense-in-depth)
- **`UNIQUE(sender_id, idempotency_key)`** — 멱등키 중복 요청 방지 (아래 7.3 참고)
- 인덱스: `(sender_id, created_at)`, `(receiver_id, created_at)` — 내 송금/수신 내역 페이징 조회용
- 원장 불변성은 애플리케이션 규약으로 강제(해당 테이블에 대한 Update/Delete 서비스 함수를 아예 만들지 않음).

**설계 이력 — 더블 엔트리 원장(`wallet_entries`) 검토 후 미채택**: `docs/research.md` §8-4의 더블 엔트리 패턴(송금 1건당 2행, `user_id` 단일 조건으로 송신·수신 내역을 한 번에 조회)을 검토해 한때 이 문서에 채택안으로 반영했으나, 그 사이 개발자가 이미 위 단일 `transfers` 테이블(양쪽 잔액 스냅샷 포함) 구조로 구현을 완료했고, 태양의 리뷰에서 동시성 레이스·데드락·CHECK 제약 우회 시도까지 실서버 재현으로 독립 검증되어 병합 가능 판정까지 끝난 상태였다. 두 설계 모두 §7.5의 위협모델을 동일하게 충족하며 차이는 "내 내역 조회 쿼리가 OR 조건 하나 필요한가"뿐인 query-ergonomics 수준이므로, 이미 검증을 마친 코드를 문서에 맞춰 다시 뜯어고치는 것은 낭비로 판단해 **문서를 실제 구현(단일 테이블 + 스냅샷 2컬럼)에 맞춰 되돌렸다**. `sent`/`received`/`all` 조회는 `WHERE senderId = X OR receiverId = X` 형태로 구현되어 있으며, 이 프로젝트 규모에서는 성능상 문제가 없다. 더블 엔트리 전환은 실제로 이 쿼리 패턴이 병목이 되거나 송금 외 잔액 변동 유형(관리자 조정 등)이 추가될 때 재검토할 후보로만 남겨둔다.

### 7.2 송금 처리 흐름 (동시성/원자성)

```
POST /api/wallet/transfer  { receiverId, amount, idempotencyKey }
```

1. **검증**: `amount`는 양의 정수(정수 파싱 실패/소수/0 이하 거부), `MAX_TRANSFER_AMOUNT`(환경변수) 이하, `receiverId !== session.userId`(자기 자신 송금 금지), 수신자 존재 및 `status === 'active'` 확인(휴면/차단 유저에게 송금 금지). `sender_id`는 항상 세션에서만 가져오고 클라이언트 입력을 신뢰하지 않는다(IDOR 원칙과 동일, §6).
2. **원자적 잔액 이동**: Prisma `$transaction` 내부에서 잔액 부족을 조건절로 직접 검증하는 **조건부 UPDATE**를 사용한다(별도의 `SELECT ... FOR UPDATE` 없이도 Postgres 행 잠금으로 안전함):

   ```
   const debit = await tx.wallet.updateMany({
     where: { userId: senderId, balance: { gte: amount } },
     data: { balance: { decrement: amount } },
   });
   if (debit.count === 0) throw new HttpError(409, "잔액이 부족합니다."); // 트랜잭션 롤백

   await tx.wallet.update({
     where: { userId: receiverId },
     data: { balance: { increment: amount } },
   });
   ```

   `updateMany`의 `WHERE balance >= amount`가 Postgres에서 해당 행에 대한 쓰기 잠금을 걸고 평가되므로, 동시에 들어온 두 번째 송금 요청은 첫 번째 트랜잭션이 커밋될 때까지 대기했다가 **갱신된 잔액 기준으로 다시 조건을 평가**한다 — lost update 없이 동시 요청이 안전하게 직렬화된다. `balance`의 `CHECK(balance >= 0)` 제약은 이 로직에 버그가 있더라도 잔액이 음수로 내려가는 것을 DB가 최종적으로 거부하는 마지막 방어선이다.
3. **데드락 방지**: 위 두 UPDATE는 서로 다른 두 행(sender, receiver)을 건드린다. A→B 송금과 B→A 송금이 동시에 발생하면 각 트랜잭션이 반대 순서로 행을 잠그려 하면서 데드락이 날 수 있다. 이를 피하기 위해 **항상 `sender_id`/`receiver_id`를 정렬한 순서로 UPDATE를 실행**한다(이미 §3 `chat_rooms`의 `user_id_low`/`user_id_high` 정렬 패턴과 동일한 접근 — 코드베이스 내 기존 관례를 재사용). Postgres가 데드락을 감지해 한쪽 트랜잭션을 자동 종료시키는 경우에도 대비해, 해당 에러코드(`40P01`)를 잡아 1회 재시도하는 로직을 서비스 레이어에 추가할 것.
4. **원장 기록**: 같은 트랜잭션 내에서 `transfers` 행을 삽입(차감/증액 후의 두 잔액을 `sender_balance_after`/`receiver_balance_after`로 스냅샷)하고 커밋.
5. 커밋 성공 시 이 트랜잭션의 결과를 API 응답으로 반환.

**리서치 반영 노트 — 잠금 방식 선택** (`docs/research.md` §8-1 조사 결과 검토): 지훈의 조사는 `SELECT ... FOR UPDATE`(raw SQL) 또는 `isolationLevel: Serializable`을 1차 방안으로 제시했다. 두 방식 모두 안전하지만, 이 기능에 필요한 것은 "잔액을 읽고 조건에 따라 갱신"이라는 단일 스텝뿐이므로, 위 §7.2의 **조건부 `updateMany`(WHERE balance >= amount) 방식을 그대로 유지**하기로 결정했다 — 이유: (1) `SELECT FOR UPDATE`는 잠금 획득과 갱신이 별도 왕복 2회로 나뉘는데, 조건부 UPDATE는 Postgres가 이미 "읽기+잠금+조건평가+쓰기"를 단일 원자적 스텝으로 수행하므로 왕복이 1회로 줄고 raw SQL(`$queryRaw`)도 필요 없어 Prisma 타입 안전성을 유지할 수 있다. (2) `Serializable`은 충돌 시 트랜잭션을 통째로 실패시켜 애플리케이션이 재시도 로직을 구현해야 하는데, 이 기능처럼 "실패 사유가 잔액 부족 하나뿐인" 단순 케이스에는 과설계다. 데드락 감지 후 1회 재시도(§7.2의 3번)는 두 방식 어디를 택하든 필요하므로 그대로 유지한다.

### 7.3 멱등키 (Idempotency Key)

- 클라이언트는 송금 시도(예: "송금 확인" 버튼 클릭) 시점에 UUID를 하나 생성해 요청 바디의 `idempotencyKey`로 함께 보낸다. 네트워크 재시도나 더블클릭으로 동일 요청이 두 번 도착해도 클라이언트는 **같은 키를 재사용**한다.
- 서버는 트랜잭션 시작 전에 `(sender_id, idempotency_key)`로 기존 `transfers` 행이 있는지 조회 — 있으면 새로 처리하지 않고 **기존 결과를 그대로 반환**(송금은 실행되지 않음, 200 응답에 기존 원장 데이터).
- 조회 후 삽입 사이에도 레이스가 있을 수 있으므로(동시에 같은 키로 두 요청이 동시 도착), 최종 방어는 `UNIQUE(sender_id, idempotency_key)` 제약이다 — 삽입 시 `P2002` 충돌이 나면 "누군가 이미 처리함"으로 간주하고 해당 행을 재조회해 반환한다. `backend/src/services/chat.service.ts`의 `startDirectRoom`에 이미 있는 P2002-캐치-후-재조회 패턴과 동일하므로 개발자에게는 낯설지 않은 패턴일 것이다.

### 7.4 회원가입 시 초기 포인트 지급

- 회원가입 처리(`auth.service.ts`의 `signup`) 트랜잭션 안에서 `users` 행 생성과 **같은 트랜잭션으로** `wallets` 행을 `balance = SIGNUP_BONUS_POINTS`(환경변수, 기본값 예: 10000)로 함께 생성한다. 두 행을 원자적으로 함께 만들어야 "지갑 없는 유저"라는 불가능해야 할 상태가 코드 어디에서도 발생하지 않는다(이후 모든 지갑 조회 코드가 null 체크를 할 필요가 없어짐).

### 7.5 보안 위협 모델 (REPORT.md 반영용)

| 위협 | 시나리오 | 방어 |
|---|---|---|
| 동시 요청 레이스 / 이중지출 | 같은 사용자가 잔액 10000일 때 8000원 송금 요청 2개를 거의 동시에 보냄 → 순진한 "잔액 조회 후 UPDATE" 구현이면 둘 다 잔액 검증을 통과해 잔액이 -6000이 됨 | §7.2의 조건부 `updateMany`(WHERE balance >= amount)가 Postgres 행 잠금으로 두 요청을 직렬화, 두 번째 요청은 차감된 잔액 기준으로 재평가되어 거부됨 |
| 음수 잔액 | 애플리케이션 로직의 버그(리팩터링 실수 등)로 조건 체크가 우회됨 | `wallets.balance`에 `CHECK(balance >= 0)` — 애플리케이션 계층과 무관하게 DB가 최종 거부 |
| 이중 처리(더블클릭/재시도) | 클라이언트 더블클릭 또는 네트워크 타임아웃 후 자동 재시도로 동일 송금 요청이 서버에 두 번 도달 | 멱등키 + `UNIQUE(sender_id, idempotency_key)` — 두 번째 요청은 신규 처리되지 않고 첫 번째 결과가 반환됨 |
| 자기 자신 송금(잔액 조작 시도) | 자신에게 송금해 원장 로그를 부풀리거나 레이스 조건을 악용 시도 | 서비스 레이어 검증 + DB `CHECK(sender_id <> receiver_id)` |
| 잘못된 금액 입력 | 음수, 0, 소수, 매우 큰 수, 숫자가 아닌 값 | Zod 스키마로 양의 정수만 허용 + `MAX_TRANSFER_AMOUNT` 상한, DB `CHECK(amount > 0)` |
| 데드락 | A→B, B→A 동시 송금 | 정렬된 순서로 행 업데이트 + `40P01` 에러코드 감지 시 1회 재시도 |
| 휴면/차단 계정으로의 자금 이동 | 이미 신고 누적으로 휴면 처리된 유저가 계속 자금을 받거나 보냄 | 수신자 `status === 'active'` 검증. 송신자는 세션 미들웨어가 이미 휴면 유저의 모든 요청을 차단(§5)하므로 자연히 방어됨 |
| 원장 위변조 | 사후에 `transfers` 행을 수정해 이력을 조작 | 원장 테이블에 대한 Update/Delete 서비스 함수를 아예 두지 않음(불변 로그 규약) |
| Rate limiting 미적용 시 어뷰징 | 짧은 시간에 다량의 송금 요청을 보내 동시성 버그를 유발하거나 계정 잔액을 빠르게 소진 | §6 rate limiting 원칙과 동일하게 `/api/wallet/transfer`에 사용자 기준 rate limit 적용 |

### 7.6 API 엔드포인트

```
GET    /api/users/me                🔒  (기존 엔드포인트 응답에 balance 필드 추가 — 마이페이지 잔액 표시)
POST   /api/wallet/transfer         🔒  { receiverId, amount, idempotencyKey } → 송금 실행
GET    /api/wallet/transactions     🔒  내 송금/수신 내역 조회 (페이징: ?before=&limit=, sent/received 구분)
```

### 7.7 `docs/research.md` §8 확인 필요 항목 회신

지훈이 §8 하단에 남긴 확인 필요 항목에 대한 답변:

1. **`wallets` 컬럼 vs 별도 테이블** → 별도 `wallets` 테이블로 확정(§7.1의 "설계 노트" 참고 — 잠금 범위를 프로필 갱신과 분리하기 위함).
2. **초기 포인트 지급 정책 / 송금 한도** → §7.4(가입 시 `SIGNUP_BONUS_POINTS` 환경변수로 지급, 회원가입 트랜잭션에 포함) 및 §7.2/§7.5(`MAX_TRANSFER_AMOUNT` 상한, `amount > 0`이 사실상의 최소 한도 1) 로 확정.
3. **휴면 유저의 송금 가능 여부** → §7.5 "휴면/차단 계정으로의 자금 이동" 행으로 확정: 수신자는 서비스 레이어에서 `status === 'active'`를 명시적으로 검증해 차단, 송신자는 별도 체크를 추가하지 않아도 §5의 세션 미들웨어가 휴면 전환된 유저의 모든 요청(이 엔드포인트 포함)을 이미 401로 막고 있어 자연히 차단됨.

---

## 8. [v1.2] 상품 검색

- 기존 `GET /api/products` 목록 엔드포인트에 **선택적 쿼리 파라미터**로 추가한다(별도 엔드포인트 신설 대신) — `GET /api/products?search=<keyword>`. 검색 결과도 §4에서 정한 "목록엔 id/name만 노출" 원칙을 그대로 따른다(상세 정보는 여전히 상세 페이지에서만).
- **검색 범위 확정** (지훈의 §9 조사에서 남긴 확인 필요 항목 회신): 필수 범위는 상품명(`name`)만. 설명(`description`)까지 포함하는 것은 선택 사항으로 남겨둔다 — 최소 요구사항 원문("상품명 기준 검색, 가능하면 설명도")이 설명 포함을 필수로 요구하지 않기 때문. 현재 규모(인덱스 미사용, 순차 스캔)에서는 `WHERE name ILIKE ... OR description ILIKE ...`로 넣어도 성능 차이가 없으므로, 넣을지 여부는 순수하게 개발 편의로 결정해도 무방하다 — 나중에 `pg_trgm` 인덱스를 추가할 때만 "인덱스 대상 컬럼을 하나 늘릴지"를 다시 판단하면 된다(§9 하단 참고).
- Prisma의 `contains`(+ `mode: 'insensitive'`)를 사용 — SQL 레벨에서는 `ILIKE '%keyword%'`로 변환되며 Prisma가 파라미터 바인딩을 처리하므로 SQLi 위험은 §6의 원칙과 동일하게 자동으로 방어된다(문자열을 직접 조합해 쿼리를 만들지 않을 것).
- **인덱스에 대한 참고**: `LIKE/ILIKE '%keyword%'`처럼 앞에 와일드카드가 붙는 검색은 일반 B-tree 인덱스를 활용하지 못해 상품 수가 많아지면 순차 스캔 비용이 커진다. 현재 규모(튜토리얼/MVP 수준의 상품 수)에서는 인덱스 없이도 충분히 빠르므로 별도 인덱스는 추가하지 않는다. 이후 상품 수가 커져 성능 이슈가 생기면 PostgreSQL `pg_trgm` 확장 + GIN trigram 인덱스(`CREATE INDEX ... USING GIN (name gin_trgm_ops)`) 도입을 검토할 것 — 지금 시점에 미리 넣는 것은 과설계로 판단해 보류.
- 검색어가 없을 때는 기존과 동일하게 전체 목록을 반환(하위 호환).

---

## 9. [v1.2] 관리자(Admin) 기능

### 9.1 스키마 확장 (기존 §3 테이블에 컬럼 추가)

- `users` 테이블에 `role` 컬럼 추가: `ENUM('user','admin') NOT NULL DEFAULT 'user'`. 회원가입 API는 이 컬럼을 절대 입력받지 않는다(요청 바디에 role이 와도 무시) — 관리자 계정은 시딩/마이그레이션 스크립트 또는 별도 운영 스크립트로만 생성한다. 공개 API로 role을 self-service 승격시키는 경로를 만들지 않는 것이 핵심 방어.
- `reports` 테이블에 처리 상태 컬럼 추가: `resolved BOOLEAN NOT NULL DEFAULT false`, `resolved_at TIMESTAMPTZ NULL`, `resolved_by UUID NULL FK → users.id`. 관리자가 신고 건을 "처리 완료" 표시할 수 있도록 함(신고 자체와 자동 차단/휴면 로직 §3/§6은 그대로 유지, 이 컬럼은 운영 관리용 부가 상태).

### 9.2 `requireAdmin` 미들웨어

- 기존 `requireAuth` 미들웨어(§5, 매 요청마다 DB에서 최신 `status` 조회)가 이미 사용자 전체 레코드를 조회해 `req.user`(또는 동등한 위치)에 채워두므로, `requireAdmin`은 **추가 DB 조회 없이** `req.user.role === 'admin'`만 검사하도록 `requireAuth` 뒤에 체이닝한다. 이렇게 하면 관리자 라우트가 매 요청마다 쿼리를 두 번 날리지 않는다.
- 검사 실패 시 `403 Forbidden` 반환(§6 IDOR 원칙과 동일하게, 권한 검증은 항상 서버 사이드에서 강제 — 프론트의 "관리자 메뉴 숨김"은 UX일 뿐 보안 경계가 아님).
- 모든 관리자 라우트는 `requireAuth` → `requireAdmin` 순서로 체이닝. 클라이언트가 보내는 어떤 값(세션에 캐시된 role 등)도 서버 재조회 없이 신뢰하지 않는다 — 관리자 승격/강등이 발생한 세션도 다음 요청부터 즉시 반영되어야 하므로 `requireAuth`가 매 요청 재조회하는 기존 설계(§5)를 그대로 활용.

### 9.3 API 엔드포인트 (모두 🔒 + `requireAdmin`, prefix `/api/admin`)

```
GET    /api/admin/users                    유저 목록 (페이징, username/status/role/report_count)
PATCH  /api/admin/users/:id/dormant        강제 휴면 처리
PATCH  /api/admin/users/:id/activate       휴면 해제 (status→active). report_count는 유지할지 리셋할지
                                            운영 정책 결정 필요 — 기본값은 "리셋" 권장(재차단까지 다시
                                            임계치를 채워야 하므로 남용 판단이 더 명확해짐)
GET    /api/admin/products                 상품 목록 (status 무관 전체 노출 — 목록 최소노출 원칙은
                                            일반 사용자 대상이므로 관리자 뷰에는 적용하지 않음)
DELETE /api/admin/products/:id             강제 삭제
PATCH  /api/admin/products/:id/unblock     차단 해제 (status→active), report_count 리셋 권장(위와 동일 이유)
GET    /api/admin/reports                  전체 신고 목록 (페이징, target 정보 조인, resolved 필터)
PATCH  /api/admin/reports/:id/resolve      처리 완료 표시 (resolved/resolved_at/resolved_by 갱신)
GET    /api/admin/wallet/transactions      전체 송금 내역 조회 (감사용, 페이징, sender/receiver/기간 필터)
```

- 일반 유저가 위 경로에 접근 시도하면 `requireAdmin`에서 일괄 403 처리.
- 상품 강제 삭제(`DELETE /api/admin/products/:id`)는 소유권 검증(§6 IDOR, `seller_id === session.userId`)을 **적용하지 않는 것이 의도**다 — 관리자는 소유자가 아니어도 삭제할 수 있어야 하므로, 이 라우트는 일반 상품 삭제 라우트(§4 `DELETE /api/products/:id`)와 별개의 컨트롤러/서비스 함수로 구현해 소유권 체크 코드를 공유하지 않도록 한다(실수로 관리자 라우트에 일반 소유권 검증이 섞여 들어가 "관리자인데도 403"이 나거나, 반대로 일반 라우트에 관리자 우회 로직이 섞여 들어가는 것을 방지).
- (참고, 이번 범위에는 포함하지 않음) 관리자 행위 자체에 대한 감사 로그(누가 언제 어떤 유저/상품/신고를 처리했는지)는 향후 필요성이 커지면 별도 `admin_actions` 로그 테이블로 확장 검토. 현재는 `resolved_by`/`resolved_at` 정도로 최소한만 남긴다.

---

## 10. [v1.2] 구현 순서 제안 (개발자 전달용)

1. `users.role`, `reports.resolved*` 컬럼 마이그레이션 + `wallets`/`transfers` 테이블 마이그레이션 생성
2. 지갑: 회원가입 트랜잭션에 초기 포인트 지급 포함 → 송금 API(§7.2 조건부 UPDATE + 멱등키) → 잔액/내역 조회 API. 동시성 로직이 가장 리스크가 크므로 **동시 요청 재현 테스트**(예: 같은 송신자로 동시에 여러 송금 요청을 쏴서 잔액이 음수로 내려가지 않는지, 멱등키 재사용 시 중복 처리되지 않는지)를 REPORT.md에 반드시 남길 것.
3. 검색: 기존 상품 목록 쿼리에 `search` 파라미터 추가 (낮은 리스크, 먼저 처리해도 무방)
4. 관리자: `role` 컬럼 → `requireAdmin` 미들웨어 → 관리자 CRUD 라우트. 일반 계정으로 관리자 라우트 접근 시 403이 정확히 나는지 검증 필수.

---

## 다음 단계 제안 (개발자 전달용, v1.0 원본)

1. Prisma 스키마 파일(schema.prisma)로 3장 테이블 정의 → 마이그레이션 생성
2. Express 프로젝트 스캐폴딩: 미들웨어 체인(2장 순서) 먼저 구성 후 라우터 추가
3. 인증(회원가입/로그인/세션) → 상품 CRUD → 신고 로직(트랜잭션) → 채팅(Socket.IO) 순으로 구현 권장 (뒤 기능이 앞 기능의 인증/권한 체계에 의존하기 때문)
4. 신고 임계치 값(예: 5회)은 환경변수로 분리해 운영 중 조정 가능하게 할 것
