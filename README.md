# Tiny Secondhand Platform

중고거래 플랫폼 MVP. 설계/조사/디자인 문서는 [`docs/`](./docs) 폴더를 참고하세요.

- [`docs/architecture.md`](./docs/architecture.md) — 시스템 설계 (민준)
- [`docs/research.md`](./docs/research.md) — 기술 조사 (지훈)
- [`docs/design.md`](./docs/design.md) — UI/UX 설계 (수아)
- [`REPORT.md`](./REPORT.md) — 보안 구현 리포트 (서연)

## 기술 스택

- 프론트엔드: React + TypeScript + Vite
- 백엔드: Node.js + Express + TypeScript
- DB: PostgreSQL + Prisma
- 실시간 채팅: Socket.IO (세션 쿠키 인증 공유)
- 인증: 세션 기반(httpOnly + secure 쿠키), JWT 미사용
- 비밀번호 해싱: bcrypt

## 요구 사항

- Node.js **18 이상** (20/22 권장 — 일부 최신 패키지의 engines 경고를 피하려면)
- PostgreSQL 14 이상 (또는 아래처럼 Docker로 실행)
- npm 9 이상 (루트에 npm workspaces로 `backend`/`frontend`가 구성되어 있음)

## 처음 설정하기

### 1. 의존성 설치 (루트에서 한 번에)

```bash
npm install
```

### 2. PostgreSQL 준비

로컬에 PostgreSQL이 있다면 데이터베이스만 하나 만들면 됩니다:

```sql
CREATE DATABASE tiny_secondhand;
```

없다면 Docker로 간단히:

```bash
docker run -d --name tsp-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=tiny_secondhand \
  -p 5432:5432 \
  postgres:16-alpine
```

### 3. 환경 변수 설정

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

`backend/.env`에서 최소한 아래 값들은 실제 배포 전 반드시 랜덤한 긴 문자열로 교체하세요:

- `SESSION_SECRET`
- `CSRF_SECRET`

운영(HTTPS) 환경에서는 `COOKIE_SECURE=true`로 설정해야 세션/CSRF 쿠키에 `Secure` 속성이 붙습니다.

### 4. DB 마이그레이션

```bash
npm run prisma:migrate
```

## 개발 서버 실행

터미널 두 개에서 각각:

```bash
npm run dev:backend   # http://localhost:4000
npm run dev:frontend  # http://localhost:5173
```

프론트엔드 개발 서버는 `/api`, `/uploads`, `/socket.io` 요청을 백엔드(4000번 포트)로 프록시하므로
브라우저에서는 `http://localhost:5173` 하나만 열면 됩니다 (`frontend/vite.config.ts` 참고).

## 프로덕션 빌드

```bash
npm run build:backend
npm run build:frontend
```

백엔드는 `backend/dist`, 프론트엔드는 `frontend/dist`에 정적 파일이 생성됩니다.
프로덕션 배포 시 프론트엔드와 백엔드가 **같은 등록 가능 도메인(registrable domain)** 아래에 있어야
세션 쿠키의 `SameSite=Lax`가 정상 동작합니다 (예: `app.example.com` + `api.example.com`, 또는 리버스 프록시로
동일 오리진처럼 묶기). `COOKIE_SECURE=true`도 함께 설정해야 합니다(HTTPS 필수).

**프로세스 매니저 필수**: 백엔드는 `uncaughtException` 발생 시 진행 중인 요청을 마무리한 뒤 **의도적으로
프로세스를 종료**합니다(예외가 어떤 상태를 거쳐 나왔는지 보장할 수 없는 상황에서 계속 서비스하는 것보다,
깨끗하게 재시작하는 편이 안전하다는 판단 — REPORT.md §14 참고). 따라서 운영 환경에서는 반드시
pm2, Docker `restart: unless-stopped`, systemd `Restart=on-failure` 등 **자동 재기동 supervisor**를 앞단에
두어야 합니다. `node dist/server.js`를 감독 없이 직접 실행하면 이런 종료 후 서비스가 복구되지 않습니다.

## 배포 (Docker Compose)

배포 환경 시뮬레이션용 컨테이너 구성이 저장소에 포함되어 있습니다
(`docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`).
개발할 때는 이 구성이 아니라 위의 개발 서버(`npm run dev:*`)를 쓰세요.

### 구성 요약

- **frontend** — Vite 프로덕션 빌드를 nginx로 정적 서빙. `/api`, `/uploads`, `/socket.io`(WebSocket
  Upgrade 포함)를 backend로 프록시하고, 그 외 경로는 SPA fallback(`index.html`)으로 처리.
  개발 시 Vite 프록시와 동일하게 **브라우저 입장에서는 단일 오리진**이므로 SameSite=Lax 세션 쿠키가
  그대로 동작합니다. 호스트에 노출되는 유일한 진입점(기본 `:8080`).
- **backend** — multi-stage 빌드(의존성 → prisma generate + tsc → 프로덕션 의존성만 담은 런타임).
  컨테이너 시작 시 `prisma migrate deploy`로 마이그레이션을 적용한 뒤 서버를 기동합니다
  (`backend/docker-entrypoint.sh`). sharp/bcrypt 네이티브 바이너리는 빌드·런타임 스테이지가 같은
  베이스 이미지를 쓰므로 항상 플랫폼이 일치합니다. 호스트 포트 미노출.
- **postgres** — `postgres:16-alpine`, named volume으로 데이터 영속화, healthcheck 통과 후에만
  backend가 기동. 세션 테이블은 `connect-pg-simple`이 첫 기동 시 자동 생성하므로 별도 준비 불필요.
- **uploads** — 상품 이미지는 named volume(`uploads-data`)에 저장되어 컨테이너를 재생성해도 유지.
- backend는 `uncaughtException` 시 의도적으로 종료하도록 설계되어 있어(아래 "프로세스 매니저 필수"),
  compose의 `restart: unless-stopped`가 supervisor 역할을 합니다.

### 실행

```bash
cp .env.example .env
# .env에서 반드시 교체: POSTGRES_PASSWORD, SESSION_SECRET, CSRF_SECRET
docker compose up -d --build
# → http://localhost:8080  (포트는 .env의 HTTP_PORT로 변경)
```

상태/로그 확인 및 정리:

```bash
docker compose ps                  # 세 서비스 모두 healthy인지
docker compose logs -f backend     # migrate deploy → "Server listening on port 4000"
docker compose down                # 중지 (볼륨 유지)
docker compose down -v             # 중지 + DB/업로드 데이터까지 삭제
```

### 주의 사항

- **빌드 컨텍스트는 저장소 루트여야 합니다.** npm workspaces라 `package-lock.json`이 루트에만 있어,
  두 Dockerfile 모두 루트 컨텍스트를 전제로 작성되어 있습니다 (compose가 이미 그렇게 설정됨).
  수동 빌드 시: `docker build -f backend/Dockerfile .`
- **HTTPS로 공개 배포할 때**: 이 compose 앞단에 TLS 종료 프록시(Caddy, Traefik, 클라우드 LB 등)를
  두고, `.env`에서 `COOKIE_SECURE=true`와 `PUBLIC_ORIGIN=https://실제도메인`을 설정하세요.
  평문 HTTP에서 `COOKIE_SECURE=true`를 켜면 브라우저가 Secure 쿠키를 조용히 버려 로그인이 전부
  실패합니다(위 3번 항목 및 `backend/src/env.ts` 주석 참고).
- **관리자 계정 승격**은 설계상 공개 API가 없습니다(§9.1). 컨테이너 환경에서는
  `backend/scripts/promoteAdmin.ts`의 실행 도구(tsx)가 런타임 이미지에 없으므로, DB 컨테이너에서
  직접 처리하는 것이 가장 간단합니다:
  ```bash
  docker compose exec postgres psql -U postgres -d tiny_secondhand \
    -c "UPDATE users SET role='admin' WHERE username='<username>';"
  ```
- 다른 아키텍처(예: Apple Silicon)에서 빌드가 실패하면 lockfile의 플랫폼별 optional dependency
  이슈일 수 있습니다 — `docs/deploy-handoff.md`의 알려진 제약 항목 참고.
- 배포 검증 절차(무엇을 어떤 명령으로 확인하는지)는 [`docs/deploy-handoff.md`](./docs/deploy-handoff.md)에
  정리되어 있습니다. 배포 토폴로지 다이어그램은 [`docs/architecture.md`](./docs/architecture.md) §11 참고.

## 알려진 제약 / 트레이드오프

- 이 저장소를 개발한 샌드박스 환경은 Node 18로 고정되어 있어, 일부 최신 패키지(`file-type`, `create-vite` 등)의
  Node 20+/22+ 요구사항과 충돌해 해당 의존성을 배제하거나 자체 구현으로 대체했습니다. 자세한 내용과 보안적 근거는
  [`REPORT.md`](./REPORT.md) 8번 항목을 참고하세요. Node 20+ 환경에서는 필요 시 재검토 가능합니다.
- `npm audit`에서 프론트엔드 devDependency인 Vite 5의 esbuild 관련 moderate 취약점이 남아있습니다.
  이는 **dev 서버에만 해당하는 이슈**(임의 사이트가 dev 서버에 요청을 보낼 수 있음)로 프로덕션 빌드 결과물에는
  영향이 없습니다. dev 서버를 신뢰되지 않은 네트워크에 노출하지 마세요(기본값은 localhost 바인딩).
- 신고 임계치는 `backend/.env`의 `PRODUCT_REPORT_THRESHOLD`, `USER_REPORT_THRESHOLD`로 운영 중 조정 가능합니다.
- **Windows에서 실행 시**: `node_modules`를 다른 OS/머신에서 설치한 뒤 복사하거나 네트워크 드라이브로 공유해서
  쓰지 마세요 — `sharp`는 OS/아키텍처별 네이티브 바이너리를 쓰기 때문에, 다른 환경에서 설치된 `node_modules`를
  그대로 가져오면 이미지 업로드가 실패합니다(서버 기동 로그에 self-check 경고가 뜹니다). Windows 머신에서
  직접 `npm install`을 실행하세요. 자세한 진단 과정은 [`REPORT.md`](./REPORT.md) 14번 항목 참고.

## 주요 스크립트

| 명령어 | 설명 |
|---|---|
| `npm run dev:backend` | 백엔드 개발 서버 (tsx watch) |
| `npm run dev:frontend` | 프론트엔드 개발 서버 (vite) |
| `npm run build:backend` | 백엔드 TypeScript 컴파일 |
| `npm run build:frontend` | 프론트엔드 타입체크 + vite build |
| `npm run prisma:generate` | Prisma Client 생성 |
| `npm run prisma:migrate` | 마이그레이션 생성/적용 (dev) |

백엔드/프론트엔드 각각의 `package.json`에 `typecheck` 스크립트도 있습니다.
