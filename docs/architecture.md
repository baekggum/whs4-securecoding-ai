# Tiny Second-hand Shopping Platform — 설계 문서

작성자: 민준 (아키텍트)
버전: v1.0

## 0. 최소 기능 요구사항 (MVP)

- 회원가입 / 로그인 / 프로필 조회 / 마이페이지(소개글·비밀번호 수정)
- 상품 등록 / 내 상품 관리 / 전체 조회(목록엔 이름만) / 상세 페이지
- 실시간 전체채팅 + 1:1 채팅
- 상품/유저 신고(사유 필수) + 일정 횟수 이상 시 상품 자동 차단 / 유저 휴면 전환

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

## 다음 단계 제안 (개발자 전달용)

1. Prisma 스키마 파일(schema.prisma)로 3장 테이블 정의 → 마이그레이션 생성
2. Express 프로젝트 스캐폴딩: 미들웨어 체인(2장 순서) 먼저 구성 후 라우터 추가
3. 인증(회원가입/로그인/세션) → 상품 CRUD → 신고 로직(트랜잭션) → 채팅(Socket.IO) 순으로 구현 권장 (뒤 기능이 앞 기능의 인증/권한 체계에 의존하기 때문)
4. 신고 임계치 값(예: 5회)은 환경변수로 분리해 운영 중 조정 가능하게 할 것
