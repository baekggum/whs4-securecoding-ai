# 배포 핸드오프 — Sprint 1 (Docker Compose)

작성자: 지훈 (DevOps). 대상: 백엔드/프론트 팀원 + Sprint 3 검증 담당.
구성 파일: `docker-compose.yml`, `backend/Dockerfile`, `backend/docker-entrypoint.sh`,
`frontend/Dockerfile`, `frontend/nginx.conf`, 루트 `.env.example`, 각 `.dockerignore`.
토폴로지 다이어그램: `docs/architecture.md` §11. 실행 방법: README "배포 (Docker Compose)".

> 이 환경에는 Docker 데몬이 없어 **실빌드는 아직 미실행**입니다. 모든 경로/스크립트/환경변수는
> 저장소 실제 내용과 교차 확인했지만(아래 "검증 완료" 참고), 첫 `docker compose up --build`는
> Sprint 3 검증 절차 1번에서 반드시 수행해야 합니다.

---

## 1. 백엔드 수정 요청 (직접 수정하지 않고 기록만 — 코드 소유는 개발 담당)

먼저, **이미 잘 되어 있어서 수정이 필요 없는 것들** (배포 관점 확인 완료):

- `app.set("trust proxy", 1)` — `backend/src/app.ts:20`에 이미 존재. nginx가 붙이는
  `X-Forwarded-For`/`X-Forwarded-Proto`와 맞물려 rate limiter의 IP 식별과 Secure 쿠키가 프록시
  뒤에서 정상 동작한다. nginx 쪽에서 두 헤더를 반드시 전달하도록 `frontend/nginx.conf`에 설정함.
- 헬스체크 엔드포인트 — `GET /health`(liveness)가 이미 존재했고, B-2 반영으로 추가된
  `GET /health/ready`(DB `SELECT 1` 포함)를 compose의 backend healthcheck가 사용한다.
- 세션 테이블 — `connect-pg-simple`의 `createTableIfMissing: true`(`session.ts`)로 자동 생성.
  마이그레이션/시딩 불필요.
- 업로드 경로 — `dist` 기준 `<앱 루트>/uploads/products`로 해석됨(`imageProcessor.ts`,
  `app.ts`의 정적 서빙과 일치). 이미지의 `/app/uploads`에 named volume을 마운트했다.

실제 **수정 요청** (모두 배포를 막지는 않음 — 우선순위 낮음):

| # | 우선순위 | 요청 | 근거 |
|---|---|---|---|
| B-1 | 낮음 · **반영됨** (민준, `backend/src/app.ts` — helmet 직후로 이동, 응답 형태 동일) | `GET /health`를 미들웨어 체인 앞(helmet 직후, 최소한 `globalLimiter`·`sessionMiddleware`보다 앞)으로 이동 | 현재 `/health`는 `app.use(globalLimiter)`(분당 120회/IP) **뒤에** 등록되어 있다(`app.ts:53` → `:69`). 컨테이너 내부 healthcheck(30초 간격, 127.0.0.1)는 전혀 문제없지만, 외부 LB/업타임 모니터 여러 개가 같은 프록시 IP로 자주 찌르는 구성이 되면 헬스체크가 429로 오탐될 수 있다. 세션 미들웨어 앞으로 빼면 프로브마다 쿠키 파싱/스토어 경유도 사라진다. |
| B-2 | 낮음 · **반영됨** (민준, `GET /health/ready` 추가 — 200 `{"status":"ready"}` / 실패 시 503 `{"status":"unavailable"}`, limiter·세션 앞 등록) | DB까지 확인하는 readiness 엔드포인트 추가 (예: `GET /health/ready` → `prisma.$queryRaw\`SELECT 1\``) | 현재 `/health`는 프로세스 생존만 보고한다(liveness). DB 커넥션이 죽어도 healthy로 보이므로, 오케스트레이터가 트래픽 차단 판단을 할 수 있는 readiness가 있으면 좋다. 추가되면 compose healthcheck를 그쪽으로 바꾸겠다. |
| B-3 | 참고 | (수정 아님, 합의 요청) 수평 확장 금지 전제 유지 | `user:dormant` 즉시 무효화가 인프로세스 EventEmitter(`events.ts`) 기반이라 backend는 1인스턴스 전제(architecture.md §5). compose도 의도적으로 1대 구성. replicas를 늘리려면 Socket.IO Redis adapter 선행 필요. |

**저장소 레벨 알려진 제약** (백엔드 코드 아님, 팀 공유):

- **Apple Silicon/arm64 빌드**: 루트 `package-lock.json`이 linux-x64 환경(npm 9.2)에서 생성되어,
  sharp의 플랫폼별 optional dependency(`@img/sharp-linux-arm64` 등)가 lockfile에 빠져 있을 수
  있다(알려진 npm 이슈). arm64 호스트에서 `npm ci`가 실패하면: (a) `docker build --platform
  linux/amd64`로 우회하거나 (b) Node 20/npm 10에서 lockfile 재생성(루트 파일이라 전원 합의 후).
- 관리자 승격 스크립트(`scripts/promoteAdmin.ts`)는 tsx(devDependency) 필요 → 런타임 이미지에
  없음. 컨테이너 환경 대안(psql 직접 UPDATE)을 README에 적어두었다.

---

## 1-bis. Sprint 3 실빌드 인시던트: `prisma migrate deploy` 기동 실패 (해결됨)

**증상**: backend entrypoint의 `migrate deploy`가 `Error: Can't write to
/app/node_modules/@prisma/engines please make sure you install "prisma" with the right
permissions.`로 5회 전부 실패 → 재시작 루프.

**실제 원인** (이미지 내부 확인으로 확정 — 최초 추정 "엔진 미복사"와는 다름): 엔진 파일은
복사되고 있었지만 **플랫폼 변형이 잘못**이었다. Prisma는 설치된 libssl을 탐지해 엔진 변형을
고르는데(`@prisma/get-platform`), `node:20-bookworm-slim`은 openssl이 없어서 deps 스테이지의
엔진 다운로드가 `debian-openssl-1.1.x` 변형으로 폴백됐다. 반면 런타임 스테이지에는 openssl 3을
설치해 두었기 때문에 CLI가 `debian-openssl-3.0.x` 엔진을 찾았고, 없으니 그 자리에서 네트워크
다운로드를 시도 → 대상 디렉토리가 root 소유 + `USER node` 실행이라 쓰기 거부. (같은 이유로
`@prisma/client`의 쿼리 엔진도 1.1.x여서, migrate를 통과했더라도 서버가 기동 직후 죽었을 문제.)

**수정** (`backend/Dockerfile`):
1. 공유 `base` 스테이지 신설 — **모든** 스테이지(deps/build/prod-deps/runtime)에 openssl 설치.
   설치 시점·generate 시점·런타임의 플랫폼 탐지가 전부 `debian-openssl-3.0.x`로 일치.
2. build 스테이지에 **빌드 실패 가드** 추가: `schema-engine-debian-openssl-3.0.x`(migrate용)와
   `.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node`(서버용)가 없으면 이미지 빌드
   자체가 실패 — 런타임 네트워크 다운로드가 필요한 이미지는 애초에 만들어질 수 없음(폐쇄망 요건).
3. 런타임 COPY 전부 `--chown=node:node` (레이어 비용 0) + `CHECKPOINT_DISABLE=1`(CLI 텔레메트리
   시도 차단 — 폐쇄망에서 행 방지).

**검증 결과 (2026-07-13 실측, 전 항목 통과)**:
- 이미지 내부: `schema-engine-debian-openssl-3.0.x` + `libquery_engine-debian-openssl-3.0.x.so.node`
  존재, 전부 `node:node` 소유. sharp self-check 경고 없음.
- §2.1: 3개 서비스 모두 healthy, `2 migrations found … All migrations have been successfully applied`
  → 서버 기동. 재시작 후 `No pending migrations to apply`(멱등성).
- §2.2: `/` 200 html, SPA fallback 200, `/assets` 미스 404, CSRF 발급, 가입/로그인/`/api/users/me`
  200 (balance="10000" = SIGNUP_BONUS_POINTS), `/api/products` 200.
- §2.3: 이미지 업로드 → sharp 재인코딩(UUID.jpg) → `GET /uploads/products/<uuid>.jpg` 200
  image/jpeg (nginx 프록시 경유). **backend 재시작 후에도 200** (named volume 영속) + 세션 유지 200.
- §2.4: WebSocket 업그레이드 101 (nginx Upgrade/Connection 헤더 통과).
- §2.5: 로그인 5회 실패 후 6회째 429 (trust proxy + XFF 기반 IP 식별 정상), CSRF 토큰 누락 PATCH 403.
- 남은 수동 항목: §2.4 브라우저 실시간 채팅 양방향/휴면 강제종료, §2.7 로컬 dev 회귀, §2.8 HTTPS.
- 스모크 잔여물: 유저 `deploy_smoke`, 상품 "smoke item" 1건 — `docker compose down -v`로 일괄 제거 가능.

---

## 2. Sprint 3 배포 검증 절차

전제: Docker 데몬이 있는 환경, 저장소 루트, 브랜치 `refactor/agile-v2`.

### 2.1 빌드·기동

```bash
cp .env.example .env
# .env 편집: POSTGRES_PASSWORD / SESSION_SECRET / CSRF_SECRET 를
# openssl rand -hex 32 등으로 교체 (플레이스홀더 그대로면 안 됨)
docker compose up -d --build
docker compose ps        # 기대: postgres/backend/frontend 모두 (healthy)
```

확인 포인트:

```bash
docker compose logs backend
# 기대 순서:
#   [entrypoint] applying database migrations (prisma migrate deploy)...
#   2 migrations found ... applied (또는 already applied)
#   [entrypoint] starting server...
#   Server listening on port 4000 (production)
#   [env] cookies: secure=false sameSite=lax; allowed frontend origin(s): http://localhost:8080
# sharp self-check 경고([startup] sharp self-check failed)가 없어야 함 ← 네이티브 모듈 플랫폼 일치 검증
docker compose exec postgres psql -U postgres -d tiny_secondhand -c '\dt'
# 기대: users/products/reports/chat_*/messages/wallets/transfers + session (자동 생성)
```

### 2.2 HTTP 경로 스모크 (curl)

```bash
BASE=http://localhost:8080

# 정적 서빙 + SPA fallback
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $BASE/            # 200 text/html
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $BASE/products/x  # 200 text/html (fallback)
curl -s -o /dev/null -w '%{http_code}\n' $BASE/assets/                     # 404 (fallback 아님 — try_files =404)

# API 프록시 + CSRF 발급
jar=$(mktemp)
TOKEN=$(curl -s -c "$jar" $BASE/api/csrf-token | sed 's/.*"csrfToken":"\([^"]*\)".*/\1/')
echo "csrf=$TOKEN"    # 비어있지 않아야 함

# 회원가입 → 로그인 세션 → 내 정보(지갑 잔액 = SIGNUP_BONUS_POINTS)
curl -s -b "$jar" -c "$jar" -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"username":"deploy_smoke","password":"password1234"}' $BASE/api/auth/signup
curl -s -b "$jar" -c "$jar" -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"username":"deploy_smoke","password":"password1234"}' $BASE/api/auth/login
curl -s -b "$jar" $BASE/api/users/me   # 기대: username=deploy_smoke, balance="10000"
```

### 2.3 업로드 경로 (sharp + 볼륨 영속성)

```bash
# 아무 jpg/png 하나로 상품 등록 (multipart) — 파일 필드명은 image
curl -s -b "$jar" -H "X-CSRF-Token: $TOKEN" \
  -F 'name=smoke item' -F 'description=deploy smoke' -F 'price=1000' \
  -F 'image=@/path/to/test.jpg' $BASE/api/products
# 응답의 imagePath로:
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $BASE/uploads/products/<파일명>.jpg
# 기대: 200 image/jpeg (nginx → backend 정적 서빙 프록시)

docker compose restart backend && sleep 15
curl -s -o /dev/null -w '%{http_code}\n' $BASE/uploads/products/<파일명>.jpg   # 여전히 200 (볼륨 영속)
curl -s -b "$jar" $BASE/api/users/me    # 여전히 200 (세션이 DB에 있어 재시작에도 유지)
```

### 2.4 WebSocket (Socket.IO 프록시)

```bash
# 핸드셰이크(폴링 단계)가 프록시를 통과하는지 — 미로그인 상태는 세션 인증에서 거부되는 것이 정상
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/socket.io/?EIO=4&transport=polling"   # 200 (엔드포인트 도달)
# Upgrade 헤더 통과 확인 (401/400이 아닌 101 또는 socket.io 레벨 거부면 프록시 OK):
curl -s -o /dev/null -w '%{http_code}\n' -b "$jar" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "$BASE/socket.io/?EIO=4&transport=websocket"    # 기대: 101
```

브라우저 확대 검증(필수): 두 브라우저(또는 시크릿 창)로 각각 가입/로그인 → 전체채팅에서 메시지가
**양방향 실시간** 수신되는지, DevTools Network 탭에서 `socket.io` 요청이 `websocket`으로
업그레이드되는지(101, polling에 머물지 않는지) 확인. 1:1 채팅, 신고 누적으로 인한 휴면 전환 시
소켓 강제 종료(§5 즉시 무효화)도 브라우저에서 확인.

### 2.5 보안 동작 (프록시 뒤에서 깨지기 쉬운 것들)

```bash
# rate limit이 클라이언트 IP 기준인지 (trust proxy + XFF): 로그인 5회 연속 실패 → 6회째 429
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w '%{http_code} ' -b "$jar" -c "$jar" \
  -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"username":"deploy_smoke","password":"wrongpass99"}' $BASE/api/auth/login; done; echo
# 기대: 401 401 401 401 401 429

# CSRF 토큰 없이 변조 요청 → 403
curl -s -o /dev/null -w '%{http_code}\n' -b "$jar" -H 'Content-Type: application/json' \
  -d '{"bio":"x"}' -X PATCH $BASE/api/users/me    # 403
```

### 2.6 재기동·정리 시나리오

```bash
docker compose down && docker compose up -d     # 재빌드 없이 기동 — 데이터(DB/업로드) 유지 확인
docker compose logs backend | grep migrate       # "No pending migrations" 류 로그로 멱등성 확인
docker compose down -v                           # 전체 삭제 시에만 데이터 제거
```

### 2.7 로컬 개발 환경 회귀 확인

이 Sprint의 산출물은 전부 신규 파일 + 문서 추가이므로 개발 플로우가 깨질 여지는 없지만, 형식상:
`npm run dev:backend` + `npm run dev:frontend`가 기존대로 동작하고 `http://localhost:5173`에서
전 기능(가입/로그인/상품/채팅/송금/관리자)이 되는지 1회 확인.

### 2.8 (선택) HTTPS 구성 검증

앞단 TLS 종료 프록시를 세우고 `.env`에서 `PUBLIC_ORIGIN=https://<도메인>`, `COOKIE_SECURE=true`
설정 후: 로그인 → `Set-Cookie`에 `Secure` 플래그 확인, `wss://` 업그레이드 확인. **평문 HTTP에서
`COOKIE_SECURE=true`를 켜면 로그인이 전부 실패하므로**(브라우저가 Secure 쿠키를 조용히 폐기) 이
조합은 검증 항목이 아니라 금지 조합이다.

---

## 3. 검증 완료 (이번 Sprint에서 파일 교차 확인한 것)

- compose의 backend 환경변수 14개 == `backend/src/env.ts` `envSchema`의 전체 키 (누락/오타 없음, YAML 파싱 검증 완료)
- Dockerfile이 쓰는 npm 스크립트(`prisma:generate`, `build`)와 prisma CLI 경로
  (`node_modules/prisma/build/index.js`, bin=`build/index.js`)가 실제 `package.json`들과 일치
- nginx 프록시 3경로(`/api`,`/uploads`,`/socket.io`) == vite dev proxy 3경로, SPA fallback 포함
- 업로드 디렉토리 해석(`dist` 기준 상위 `uploads/`) == 볼륨 마운트 지점 `/app/uploads`
- `VITE_API_BASE_URL=""` → `client.ts`/`SocketContext.tsx` 모두 상대 URL·동일 오리진으로 동작
- entrypoint `sh -n` 문법 검증, 실행 권한 부여 완료
