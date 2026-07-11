# Tiny Second-hand Shopping Platform — 기술 조사 (지훈)

> 조사 범위: Node.js / Express 스택 기준. 실제 구현은 각 도메인 담당자가 진행하며, 아래 코드는 설정/사용법 참고용 스니펫입니다.
> 조사일: 2026-07-11

---

## 1. 실시간 채팅 구현 방식 비교 (전체채팅 + 1:1채팅 동시 지원)

### 옵션 비교

| 방식 | 장점 | 단점 | 비고 |
|---|---|---|---|
| **Socket.IO** (`socket.io`) | 자동 재연결, 폴백(polling), Room/Namespace 기반 브로드캐스트, ack 콜백, 클러스터 확장용 어댑터(`@socket.io/redis-adapter`) 제공 | 순수 WebSocket보다 페이로드 오버헤드 있음, 프로토콜이 socket.io 전용(표준 WS 클라이언트와 비호환) | 채팅 요구사항(전체+1:1)에 가장 적합 |
| **순수 `ws`** (`ws` 패키지) | 가볍고 표준 WebSocket 프로토콜 그대로 사용, 오버헤드 최소 | Room 개념·재연결·브로드캐스트 로직을 직접 구현해야 함 | 실시간 요구사항이 단순할 때만 고려 |
| **Server-Sent Events (SSE)** | 구현 단순, HTTP 기반 | 단방향(서버→클라이언트)만 지원, 채팅처럼 양방향 필요한 경우 부적합 | 채팅용으로는 제외 |

### 추천안: Socket.IO

전체채팅(공개 채널)과 1:1채팅(개인 DM)을 동시에 지원해야 하므로, **Room 기반 브로드캐스트를 기본 제공하는 Socket.IO**가 적합합니다.

- **전체채팅**: 고정된 room 이름(예: `general`)에 모든 사용자를 join
- **1:1채팅**: 두 사용자 ID를 정렬 후 조합한 결정론적 room ID (예: `dm_{minUserId}_{maxUserId}`)를 사용하면 항상 동일한 room으로 매핑됨
- 서버 측에서 반드시 "해당 유저가 이 room에 join할 권한이 있는지"를 검증해야 함 (클라이언트가 임의 room ID를 보내 다른 사람의 DM을 엿볼 수 있으므로)
- 다중 서버(수평 확장) 시에는 `@socket.io/redis-adapter`로 room 상태를 서버 간 공유

```js
// server.js
const { Server } = require("socket.io");
const io = new Server(httpServer, { cors: { origin: FRONTEND_ORIGIN } });

io.use((socket, next) => {
  // JWT 등으로 인증 — 인증 안 된 소켓 연결 자체를 차단
  const user = verifyToken(socket.handshake.auth.token);
  if (!user) return next(new Error("unauthorized"));
  socket.user = user;
  next();
});

io.on("connection", (socket) => {
  // 전체 채팅방 자동 입장
  socket.join("general");

  // 1:1 채팅방 입장 (권한 검증 포함)
  socket.on("dm:join", (targetUserId) => {
    const roomId = ["dm", socket.user.id, targetUserId].sort().join("_");
    // TODO: DB 조회로 두 사용자가 실제 대화 상대인지 확인
    socket.join(roomId);
  });

  socket.on("dm:message", ({ targetUserId, text }) => {
    const roomId = ["dm", socket.user.id, targetUserId].sort().join("_");
    io.to(roomId).emit("dm:message", { from: socket.user.id, text });
  });

  socket.on("chat:message", (text) => {
    io.to("general").emit("chat:message", { from: socket.user.id, text });
  });
});
```

**참고**: [Rooms | Socket.IO](https://socket.io/docs/v3/rooms/), [Socket.io Namespaces and Rooms - DEV Community](https://dev.to/wpreble1/socket-io-namespaces-and-rooms-d5h)

---

## 2. 비밀번호 해싱

### 옵션 비교

| 라이브러리 | 알고리즘 | 상태 |
|---|---|---|
| `bcrypt` (또는 `bcryptjs`) | bcrypt | 검증된 표준, 여전히 안전하나 72바이트 입력 제한 존재 |
| `argon2` (`argon2` npm, node-argon2 바인딩) | Argon2id | OWASP·NIST가 신규 프로젝트에 권장하는 최신 표준, 메모리 하드 특성으로 GPU 크래킹에 더 강함 |

### 권장안

신규 프로젝트이므로 **`argon2` (Argon2id)** 를 1순위로 권장. 네이티브 빌드 이슈나 배포 환경 제약이 있다면 `bcrypt`도 무방한 대안입니다.

- **Argon2id 권장 파라미터 (OWASP)**: memory 64MB, iterations 3, parallelism 4, salt 16바이트 이상, 출력 32바이트
- **bcrypt 사용 시**: salt rounds **12 이상** (12는 최소선, 보안을 중시하면 13~14). rounds가 1 증가할 때마다 연산량이 2배가 되므로 서버 부하와 트레이드오프 고려

```js
// argon2 예시
const argon2 = require("argon2");

async function hashPassword(plain) {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64MB
    timeCost: 3,
    parallelism: 4,
  });
}

async function verifyPassword(hash, plain) {
  return argon2.verify(hash, plain);
}
```

```js
// bcrypt 예시 (대안)
const bcrypt = require("bcrypt");
const SALT_ROUNDS = 12;

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(hash, plain) {
  return bcrypt.compare(plain, hash);
}
```

**참고**: [Password Hashing 2026: bcrypt vs Argon2 vs scrypt](https://www.pkgpulse.com/guides/bcrypt-vs-argon2-vs-scrypt-password-hashing-2026), OWASP Password Storage Cheat Sheet

---

## 3. SQL Injection 방지 — ORM/쿼리빌더 비교

| 옵션 | 특징 | SQL Injection 방지 방식 |
|---|---|---|
| **Prisma** (`prisma`, `@prisma/client`) | 타입 안전 쿼리, 마이그레이션 도구 내장, 스키마 기반 코드 생성 | 표준 CRUD API는 내부적으로 파라미터 바인딩 처리. 단, `$queryRawUnsafe`/문자열 템플릿 조합 오용 시 injection 가능하므로 반드시 `$queryRaw` 태그드 템플릿만 사용 |
| **Sequelize** (`sequelize`) | 성숙한 생태계, 다양한 DB 지원, `Model.findAll` 등 쿼리 빌더 | 바인드 파라미터(`replacements`, `bind`) 사용 시 안전. `sequelize.query()`에 문자열 concat으로 값을 넣으면 취약 — 과거 CVE 다수 존재했던 이력 있음 |
| **better-sqlite3** (경량 SQLite 드라이버, ORM 아님) | 동기 API, 매우 빠름, 의존성 최소 | `?` 플레이스홀더 기반 prepared statement로 파라미터 바인딩. ORM 편의기능은 없으므로 직접 쿼리 작성 필요 |

### 권장안

프로젝트 성격(중고거래 플랫폼, 관계형 데이터 다수 — 상품/유저/채팅/거래내역)을 고려하면:

- **PostgreSQL/MySQL 사용 예정이라면 Prisma** 추천 — 타입 안전성과 마이그레이션 관리가 팀 협업에 유리하고, 원시 쿼리 오·남용만 피하면 injection 위험이 낮음
- **경량 단일 서버 / SQLite로 충분한 MVP라면 better-sqlite3** — 단, 모든 쿼리에서 반드시 파라미터 바인딩(`?`)을 사용해야 하며 문자열 concat 절대 금지

```js
// Prisma — 안전 (자동 파라미터 바인딩)
const user = await prisma.user.findUnique({ where: { email: inputEmail } });

// Prisma raw query — 안전 (태그드 템플릿, 자동 이스케이프)
const rows = await prisma.$queryRaw`SELECT * FROM "User" WHERE email = ${inputEmail}`;

// Prisma raw query — 절대 금지 (문자열 결합, injection 취약)
// await prisma.$queryRawUnsafe(`SELECT * FROM "User" WHERE email = '${inputEmail}'`);
```

```js
// Sequelize — 안전 (replacements 바인딩)
const [rows] = await sequelize.query(
  "SELECT * FROM users WHERE email = :email",
  { replacements: { email: inputEmail }, type: QueryTypes.SELECT }
);
```

```js
// better-sqlite3 — 안전 (? 플레이스홀더)
const stmt = db.prepare("SELECT * FROM users WHERE email = ?");
const user = stmt.get(inputEmail);
```

**참고**: [Prisma Raw Query Leads to SQL Injection? Yes and No](https://www.nodejs-security.com/blog/prisma-raw-query-sql-injection), [Prisma ORM vs Sequelize](https://www.prisma.io/docs/orm/more/comparisons/prisma-and-sequelize)

---

## 4. XSS 방지

### 4-1. 출력 이스케이프

- 서버 템플릿(EJS/Pug 등) 사용 시 기본 출력 태그(`<%= %>` in EJS)는 자동 이스케이프됨 — `<%- %>`(raw) 사용 금지
- 프론트가 React/Vue 등 SPA라면 프레임워크 기본 렌더링이 자동 이스케이프하므로 `dangerouslySetInnerHTML`/`v-html` 사용을 피하거나, 불가피할 경우 `DOMPurify`(`dompurify` npm)로 sanitize 후 렌더

### 4-2. HTTP 보안 헤더 — `helmet` (npm: `helmet`)

Express 앱에 CSP를 포함한 보안 헤더 세트를 한 번에 적용하는 표준 미들웨어.

```js
const helmet = require("helmet");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],           // 인라인 스크립트 금지 → XSS 공격면 축소
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://cdn.example.com"],
        connectSrc: ["'self'", "wss://chat.example.com"], // Socket.IO 연결 허용
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);
```

- `helmet()` 기본 호출만으로도 `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Strict-Transport-Security` 등 13개 헤더가 적용됨
- 동적 인라인 스크립트가 필요하면 요청마다 nonce를 생성해 `script-src`에 `'nonce-...'`로 등록 (`'unsafe-inline'` 사용 지양)

**참고**: [Helmet.js 공식](https://helmetjs.github.io/), [helmet CSP README](https://github.com/helmetjs/helmet/blob/main/middlewares/content-security-policy/README.md)

---

## 5. CSRF 방지

### 상태 확인 — `csurf`는 deprecated

`csurf`(Express 팀 공식 미들웨어)는 유지보수 중단(deprecated) 상태입니다. 대안:

| 옵션 | 설명 |
|---|---|
| **`csrf-csrf`** (npm) | csurf 후속으로 만들어진 패키지. Double Submit Cookie 패턴 기본 구현 |
| **`@dr.pogodin/csurf`** | 기존 csurf의 유지보수 포크 |
| **SameSite 쿠키 전략만으로 대응** | API가 SPA + JWT/Bearer 토큰 기반이고 쿠키를 인증에 쓰지 않는다면 CSRF 위험 자체가 크게 줄어듦 |

### 권장안

- **세션 쿠키 기반 인증**을 쓴다면 → `csrf-csrf` 패키지로 Double Submit Cookie 패턴 적용 + 쿠키에 `SameSite=Strict`(또는 최소 `Lax`) 설정
- **JWT를 Authorization 헤더로 전달**하는 방식(쿠키에 토큰 저장 안 함)이면 CSRF 대응 미들웨어 없이도 구조적으로 안전 — 단, refresh token을 쿠키에 저장한다면 그 쿠키만은 `httpOnly + SameSite=Strict + Secure`로 보호 필요

```js
// csrf-csrf 예시
const { doubleCsrf } = require("csrf-csrf");

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET,
  cookieName: "__Host-csrf-token",
  cookieOptions: { sameSite: "strict", secure: true, httpOnly: true },
});

app.get("/csrf-token", (req, res) => {
  res.json({ csrfToken: generateToken(req, res) });
});

app.post("/api/*", doubleCsrfProtection); // 상태 변경 라우트에 적용
```

```js
// 세션/인증 쿠키 SameSite 전략 (기본 방어선)
res.cookie("session", sessionId, {
  httpOnly: true,
  secure: true,       // HTTPS 전용
  sameSite: "strict", // 크로스 사이트 요청에는 쿠키 미전송 → CSRF 무력화
});
```

**참고**: [csrf-csrf - npm](https://www.npmjs.com/package/csrf-csrf), [CSURF deprecation · Issue #155](https://github.com/expressjs/discussions/issues/155)

---

## 6. 파일 업로드 안전 처리 (`multer`)

기본 `multer`는 **클라이언트가 보낸 확장자/MIME 타입을 그대로 신뢰**하므로 그 자체로는 안전하지 않음 (예: `.exe`를 `.jpg`로 이름만 바꾸고 `Content-Type: image/jpeg`로 위장해도 통과). 다음 방어선을 함께 적용해야 합니다.

### 체크리스트

1. **확장자 화이트리스트** — 허용 목록만 통과
2. **MIME 타입 검증** — 클라이언트 신고값은 참고만, 신뢰 금지
3. **매직 바이트(파일 시그니처) 검증** — `file-type` 패키지로 실제 파일 내용을 읽어 진짜 타입 확인 (가장 중요한 방어선)
4. **파일 크기 제한** — `limits.fileSize`로 DoS 방지
5. **파일명 랜덤화** — 원본 파일명 대신 `crypto.randomUUID()` 등으로 재생성 (path traversal, 파일명 충돌·추측 방지)
6. **저장 경로 격리** — 웹 루트 바깥, 실행 권한 없는 디렉토리에 저장, 정적 서빙 시 `Content-Disposition: attachment`와 `X-Content-Type-Options: nosniff` 적용

```js
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const { fileTypeFromBuffer } = require("file-type");

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "/var/app-uploads/products"), // 웹 루트 밖
  filename: (req, file, cb) => {
    const randomName = crypto.randomUUID();
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomName}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("허용되지 않은 파일 형식입니다"));
    }
    cb(null, true);
  },
});

// fileFilter 통과 후, 저장된 실제 바이트로 2차 검증 (매직 바이트)
app.post("/products/upload", upload.single("image"), async (req, res) => {
  const buffer = await fs.promises.readFile(req.file.path);
  const type = await fileTypeFromBuffer(buffer);
  if (!type || !ALLOWED_MIME.has(type.mime)) {
    await fs.promises.unlink(req.file.path); // 위조 파일 삭제
    return res.status(400).json({ error: "파일 내용이 확장자와 일치하지 않습니다" });
  }
  res.json({ url: `/uploads/products/${req.file.filename}` });
});
```

**참고**: [Weak Multer File Name Manipulation - nodejs-security.com](https://www.nodejs-security.com/learn/secure-file-handling/weak-multer-file-types-validation), [File-Type Validation in Multer is NOT SAFE](https://dev.to/ayanabilothman/file-type-validation-in-multer-is-not-safe-3h8l)

---

## 7. Rate Limiting — 로그인 브루트포스 방지 (`express-rate-limit`)

### 권장 설정

- 로그인/회원가입 등 **인증 라우트 전용으로 별도의 엄격한 limiter** 적용 (일반 API와 분리)
- 창(window) 15분에 5회 시도 정도가 일반적 기준
- `skipSuccessfulRequests: true`로 설정하면 로그인 성공 요청은 카운트에서 제외되어, 정상 사용자가 반복 로그인해도 차단되지 않음
- 다중 서버 환경(수평 확장)에서는 메모리 스토어 대신 `rate-limit-redis`로 Redis 기반 공유 스토어 사용 필요 (서버별로 카운터가 따로 돌면 우회 가능)
- 추가 방어선으로 IP+계정 조합 잠금, 실패 누적 시 CAPTCHA 도입 고려 (`express-brute`, `rate-limiter-flexible` 등도 대안으로 검토 가능)

```js
const rateLimit = require("express-rate-limit");
const RedisStore = require("rate-limit-redis");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 5,                    // IP당 15분 내 5회
  skipSuccessfulRequests: true, // 로그인 성공은 카운트 제외
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요." },
  store: new RedisStore({ sendCommand: (...args) => redisClient.sendCommand(args) }),
});

app.post("/api/login", loginLimiter, loginHandler);
```

**참고**: [express-rate-limit 공식 문서](https://express-rate-limit.mintlify.app/), [Stop API Abuse Dead in Its Tracks](https://dev.to/alex_aslam/stop-api-abuse-dead-in-its-tracks-rate-limiting-with-express-rate-limit-1fbl)

---

## 종합 추천 패키지 목록

| 영역 | 추천 패키지 |
|---|---|
| 실시간 채팅 | `socket.io`, (확장 시) `@socket.io/redis-adapter` |
| 비밀번호 해싱 | `argon2` (대안: `bcrypt`) |
| DB 접근 | `prisma` + `@prisma/client` (경량 MVP는 `better-sqlite3`) |
| XSS/보안 헤더 | `helmet`, (필요 시) `dompurify` |
| CSRF | `csrf-csrf` (세션 쿠키 인증 시) 또는 SameSite 쿠키 전략 (토큰 헤더 인증 시) |
| 파일 업로드 | `multer` + `file-type` (매직 바이트 검증용) |
| Rate limiting | `express-rate-limit`, (분산 환경) `rate-limit-redis` |

---

## 다음 단계 제안 (민준 확인 필요)

- 인증 방식(세션 쿠키 vs JWT 헤더)이 확정되어야 CSRF 대응 전략을 확정할 수 있음
- DB 종류(PostgreSQL/MySQL vs SQLite)가 확정되어야 ORM 최종 선택 가능
