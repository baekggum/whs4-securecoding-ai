// Full-feature E2E regression script for the refactor/agile-v2 branch
// (Sprint 3 pre-flight, REPORT.md verification items). Not part of the
// automated build — run by hand against a running dev server:
//
//   node backend/scripts/verifyFullE2E.js
//
// Covers: auth lifecycle, CSRF double-submit, product CRUD + image
// pipeline (sharp) + IDOR + search + cursor pagination, 1:1 chat REST +
// Socket.IO realtime, report -> dormant auto-transition including the
// live-socket force-disconnect (review C-1), duplicate-report 409, and
// health probes. Wallet/admin edge cases live in
// verifyWalletAdminEdgeCases.js and are not repeated here.
//
// Accounts are created with a per-run unique suffix so the script is
// re-runnable. NOTE: the auth limiter allows 5 *failed* auth attempts per
// IP per 15 minutes (successes are skipped); this script deliberately
// performs 3 failures per run, so more than one run inside a 15-minute
// window may see 429s on the negative auth checks.

const BASE = process.env.VERIFY_BASE_URL || "http://localhost:4000";
const { io } = require("/home/hyeonmin/tiny-secondhand-platform/node_modules/socket.io-client");

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = "testpass123!";

let pass = 0;
let fail = 0;
const failures = [];

function check(label, condition, extra) {
  if (condition) {
    pass++;
    console.log(`  [PASS] ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    failures.push(label + (extra ? " — " + extra : ""));
    console.log(`  [FAIL] ${label}${extra ? " — " + extra : ""}`);
  }
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

// ---------------------------------------------------------------------------
// Minimal cookie-jar HTTP client (one per simulated browser/user).
// ---------------------------------------------------------------------------
class Client {
  constructor(name) {
    this.name = name;
    this.cookies = new Map(); // name -> value
    this.csrfToken = null;
    this.lastSetCookies = [];
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  absorbSetCookies(headers) {
    const all = headers.getSetCookie
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter(Boolean);
    this.lastSetCookies = all;
    for (const raw of all) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = /expires=Thu, 01 Jan 1970/i.test(raw) || /max-age=0/i.test(raw);
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async fetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(`${BASE}${path}`, { ...options, headers });
    this.absorbSetCookies(res.headers);
    let body = null;
    const text = await res.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body, headers: res.headers, setCookies: this.lastSetCookies };
  }

  async json(method, path, data, extraHeaders = {}) {
    return this.fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.csrfToken ? { "x-csrf-token": this.csrfToken } : {}),
        ...extraHeaders,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  }

  async refreshCsrf() {
    const res = await this.fetch("/api/csrf-token");
    if (res.status !== 200 || !res.body?.csrfToken) {
      throw new Error(`csrf-token failed for ${this.name}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    this.csrfToken = res.body.csrfToken;
    return this.csrfToken;
  }

  async signup(username) {
    await this.refreshCsrf();
    const res = await this.json("POST", "/api/auth/signup", { username, password: PASSWORD });
    return res;
  }

  socket() {
    return io(BASE, {
      transports: ["websocket", "polling"],
      reconnection: false,
      extraHeaders: { Cookie: this.cookieHeader() },
    });
  }
}

// 1x1 valid PNG — small but real, enough to exercise magic-byte sniff +
// sharp re-encode to JPEG.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function createProduct(client, name, description, price) {
  const fd = new FormData();
  fd.append("name", name);
  fd.append("description", description);
  fd.append("price", String(price));
  fd.append("image", new Blob([TINY_PNG], { type: "image/png" }), "photo.png");
  return client.fetch("/api/products", {
    method: "POST",
    headers: { "x-csrf-token": client.csrfToken },
    body: fd,
  });
}

function connectSocket(client, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const s = client.socket();
    const t = setTimeout(() => {
      s.close();
      reject(new Error("socket connect timeout"));
    }, timeoutMs);
    s.on("connect", () => {
      clearTimeout(t);
      resolve(s);
    });
    s.on("connect_error", (err) => {
      clearTimeout(t);
      reject(new Error(`connect_error: ${err.message}`));
    });
  });
}

function emitAck(socket, event, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} ack timeout`)), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(t);
      resolve(ack);
    });
  });
}

function waitForEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (...args) => {
      clearTimeout(t);
      resolve(args);
    });
  });
}

async function main() {
  console.log(`Full E2E verification against ${BASE} (run suffix: ${RUN})`);

  const A = new Client("A"); // main user / seller
  const B = new Client("B"); // second user / chat partner / reporter
  const C = new Client("C"); // report target (goes dormant)
  const D = new Client("D"); // third reporter
  const nameA = `e2e_a_${RUN}`;
  const nameB = `e2e_b_${RUN}`;
  const nameC = `e2e_c_${RUN}`;
  const nameD = `e2e_d_${RUN}`;

  // ------------------------------------------------------------- 7. health
  // /health*는 nginx가 프록시하지 않는 내부 전용 경로다(compose healthcheck가
  // 컨테이너 안에서 직접 호출). 프록시(:8080) 대상 실행 시에는
  // VERIFY_SKIP_HEALTH=1로 건너뛰고 컨테이너 내부에서 별도 확인할 것.
  section("7. Health probes");
  if (process.env.VERIFY_SKIP_HEALTH === "1") {
    console.log("  [SKIP] VERIFY_SKIP_HEALTH=1 — 프록시 경유 실행, 내부에서 별도 검증");
  } else {
    const h = await new Client("probe").fetch("/health");
    check("GET /health → 200 {ok:true}", h.status === 200 && h.body?.ok === true, JSON.stringify(h.body));
    const r = await new Client("probe").fetch("/health/ready");
    check(
      "GET /health/ready → 200 {status:'ready'}",
      r.status === 200 && r.body?.status === "ready",
      JSON.stringify(r.body)
    );
  }

  // --------------------------------------------------------------- 1. auth
  section("1. Auth lifecycle");
  {
    const res = await A.signup(nameA);
    check("signup → 201 + user object", res.status === 201 && res.body?.user?.username === nameA, `status=${res.status}`);

    const dup = await A.json("POST", "/api/auth/signup", { username: nameA, password: PASSWORD });
    check("duplicate username signup → 409", dup.status === 409, `status=${dup.status} body=${JSON.stringify(dup.body)}`);

    const out = await A.json("POST", "/api/auth/logout");
    check("logout → 204", out.status === 204, `status=${out.status}`);
    const clearedSid = out.setCookies.some(
      (c) => c.startsWith("tsp.sid=") && (/expires=Thu, 01 Jan 1970/i.test(c) || c.startsWith("tsp.sid=;"))
    );
    const clearedCsrf = out.setCookies.some(
      (c) => c.startsWith("tsp.csrf=") && (/expires=Thu, 01 Jan 1970/i.test(c) || c.startsWith("tsp.csrf=;"))
    );
    check("logout clears session cookie (Set-Cookie tsp.sid)", clearedSid, JSON.stringify(out.setCookies));
    check("logout clears CSRF cookie (Set-Cookie tsp.csrf)", clearedCsrf);

    const meAfterLogout = await A.fetch("/api/users/me");
    check("GET /api/users/me after logout → 401", meAfterLogout.status === 401, `status=${meAfterLogout.status}`);

    await A.refreshCsrf();
    const login = await A.json("POST", "/api/auth/login", { username: nameA, password: PASSWORD });
    check("login → 200", login.status === 200 && login.body?.user?.username === nameA, `status=${login.status}`);

    const me = await A.fetch("/api/users/me");
    check("GET /api/users/me → 200 (self)", me.status === 200 && me.body?.user?.username === nameA, `status=${me.status}`);

    // Enumeration resistance: wrong password vs nonexistent username.
    const wrongPw = new Client("wrongpw");
    await wrongPw.refreshCsrf();
    const r1 = await wrongPw.json("POST", "/api/auth/login", { username: nameA, password: "definitely-wrong-1" });
    const noUser = new Client("nouser");
    await noUser.refreshCsrf();
    const r2 = await noUser.json("POST", "/api/auth/login", { username: `no_such_${RUN}`, password: "whatever-123" });
    check(
      "wrong password and unknown username both → 401",
      r1.status === 401 && r2.status === 401,
      `status=${r1.status}/${r2.status}` + (r1.status === 429 || r2.status === 429 ? " (429 = authLimiter, rerun later)" : "")
    );
    check(
      "wrong password / unknown username share the same error message",
      r1.body?.error && r1.body.error === r2.body?.error,
      `${JSON.stringify(r1.body?.error)} vs ${JSON.stringify(r2.body?.error)}`
    );
  }

  // --------------------------------------------------------------- 2. CSRF
  section("2. CSRF double-submit");
  {
    const res = await A.fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" }, // session cookie sent, no x-csrf-token
      body: JSON.stringify({ targetType: "user", targetId: "00000000-0000-0000-0000-000000000000", reason: "csrf negative test" }),
    });
    check(
      "mutating request without CSRF token → 403 + code CSRF_INVALID",
      res.status === 403 && res.body?.code === "CSRF_INVALID",
      `status=${res.status} body=${JSON.stringify(res.body)}`
    );
  }

  // ----------------------------------------------------------- 3. products
  section("3. Products (image pipeline / IDOR / search / pagination)");
  const searchToken = `zqx${RUN}`; // unlikely to collide with existing data
  let product1 = null;
  let product2 = null;
  {
    const res = await createProduct(A, `E2E 상품1 ${searchToken}`, `설명1 ${searchToken}`, 15000);
    product1 = res.body?.product ?? null;
    check("create product (multipart + PNG) → 201", res.status === 201 && !!product1?.id, `status=${res.status} body=${JSON.stringify(res.body)}`);
    check(
      "sharp re-encoded image (imagePath is a .jpg)",
      typeof product1?.imagePath === "string" && product1.imagePath.endsWith(".jpg"),
      `imagePath=${product1?.imagePath}`
    );

    if (product1?.imagePath) {
      const img = await fetch(`${BASE}/uploads/products/${product1.imagePath}`);
      check(
        "processed image served from /uploads → 200 image/jpeg",
        img.status === 200 && (img.headers.get("content-type") || "").includes("image/jpeg"),
        `status=${img.status} type=${img.headers.get("content-type")}`
      );
    } else {
      check("processed image served from /uploads → 200 image/jpeg", false, "no imagePath to fetch");
    }

    const list = await A.fetch(`/api/products?search=${searchToken}`);
    const listed = list.body?.items?.some((p) => p.id === product1?.id);
    check("product appears in list", list.status === 200 && listed, `status=${list.status} items=${list.body?.items?.length}`);
    const minimalShape = list.body?.items?.every((p) => {
      const keys = Object.keys(p).sort().join(",");
      return keys === "id,name";
    });
    check("list keeps minimal exposure (id+name only)", !!minimalShape, JSON.stringify(list.body?.items?.[0]));

    const detail = await A.fetch(`/api/products/${product1.id}`);
    check(
      "product detail → 200 with seller info",
      detail.status === 200 && detail.body?.product?.seller?.username === nameA,
      `status=${detail.status}`
    );

    const upd = await A.json("PATCH", `/api/products/${product1.id}`, { price: 17000 });
    check("owner update → 200, field applied", upd.status === 200 && upd.body?.product?.price === 17000, `status=${upd.status}`);

    // IDOR: B tries to modify A's product.
    const sb = await B.signup(nameB);
    if (sb.status !== 201) throw new Error(`signup B failed: ${JSON.stringify(sb.body)}`);
    const idor = await B.json("PATCH", `/api/products/${product1.id}`, { price: 1 });
    check(
      "IDOR: other user's PATCH → 403 (not CSRF)",
      idor.status === 403 && idor.body?.code !== "CSRF_INVALID",
      `status=${idor.status} body=${JSON.stringify(idor.body)}`
    );
    const afterIdor = await A.fetch(`/api/products/${product1.id}`);
    check("IDOR attempt did not change data", afterIdor.body?.product?.price === 17000, `price=${afterIdor.body?.product?.price}`);

    // Search positive/negative.
    const hit = await A.fetch(`/api/products?search=${searchToken}`);
    const miss = await A.fetch(`/api/products?search=zz_no_match_${RUN}`);
    check(
      "search matches name/description",
      hit.status === 200 && hit.body?.items?.length >= 1,
      `hits=${hit.body?.items?.length}`
    );
    check("search with no match → empty items", miss.status === 200 && miss.body?.items?.length === 0, `hits=${miss.body?.items?.length}`);

    // Pagination (refactored cursor helper): 2 matching products, limit=1.
    const res2 = await createProduct(A, `E2E 상품2 ${searchToken}`, `설명2 ${searchToken}`, 25000);
    product2 = res2.body?.product ?? null;
    check("create second product → 201", res2.status === 201 && !!product2?.id, `status=${res2.status}`);

    const page1 = await A.fetch(`/api/products?search=${searchToken}&limit=1`);
    const p1ok = page1.status === 200 && page1.body?.items?.length === 1 && !!page1.body?.nextCursor;
    check(
      "pagination page1: limit=1 → 1 item + nextCursor",
      p1ok,
      `items=${page1.body?.items?.length} nextCursor=${page1.body?.nextCursor}`
    );
    check(
      "pagination: nextCursor equals last returned item id",
      page1.body?.nextCursor === page1.body?.items?.[0]?.id,
      `cursor=${page1.body?.nextCursor} lastId=${page1.body?.items?.[0]?.id}`
    );

    const page2 = await A.fetch(`/api/products?search=${searchToken}&limit=1&cursor=${page1.body?.nextCursor}`);
    const ids = new Set([page1.body?.items?.[0]?.id, page2.body?.items?.[0]?.id]);
    check(
      "pagination page2: next item, no overlap",
      page2.status === 200 && page2.body?.items?.length === 1 && ids.size === 2,
      `items=${page2.body?.items?.length} ids=${[...ids].join("/")}`
    );
    check("pagination: last page nextCursor=null", page2.body?.nextCursor === null, `nextCursor=${page2.body?.nextCursor}`);
    const bothMine = [page1, page2].every((p) => [product1?.id, product2?.id].includes(p.body?.items?.[0]?.id));
    check("pagination pages contain exactly the 2 created products", bothMine);

    // Delete.
    const del2 = await A.json("DELETE", `/api/products/${product2.id}`);
    check("delete product → 204", del2.status === 204, `status=${del2.status}`);
    const gone = await A.fetch(`/api/products/${product2.id}`);
    check("deleted product detail → 404", gone.status === 404, `status=${gone.status}`);
    await A.json("DELETE", `/api/products/${product1.id}`); // cleanup
  }

  // --------------------------------------------------------------- 4. chat
  section("4. Chat (REST + Socket.IO)");
  let socketA = null;
  let socketB = null;
  {
    const meA = await A.fetch("/api/users/me");
    const meB = await B.fetch("/api/users/me");
    const idA = meA.body?.user?.id;
    const idB = meB.body?.user?.id;

    const room1 = await A.json("POST", "/api/chat/rooms/direct", { targetUserId: idB });
    check("create 1:1 room → 201", room1.status === 201 && !!room1.body?.room?.id, `status=${room1.status}`);
    const room2 = await B.json("POST", "/api/chat/rooms/direct", { targetUserId: idA });
    check(
      "same pair re-request → same room id (idempotent)",
      room2.body?.room?.id === room1.body?.room?.id,
      `${room1.body?.room?.id} vs ${room2.body?.room?.id}`
    );
    const roomId = room1.body?.room?.id;

    try {
      socketA = await connectSocket(A);
      socketB = await connectSocket(B);
      check("Socket.IO connects with session cookie auth", true, `A=${socketA.id} B=${socketB.id}`);
    } catch (err) {
      check("Socket.IO connects with session cookie auth", false, err.message);
    }

    if (socketA && socketB) {
      const joinA = await emitAck(socketA, "join_room", { roomId }).catch((e) => ({ ok: false, message: e.message }));
      const joinB = await emitAck(socketB, "join_room", { roomId }).catch((e) => ({ ok: false, message: e.message }));
      check("join_room ack ok (both users)", joinA?.ok === true && joinB?.ok === true, JSON.stringify({ joinA, joinB }));

      const content = `안녕하세요, E2E 메시지 ${RUN}`;
      const received = waitForEvent(socketB, "receive_message");
      const sendAck = await emitAck(socketA, "send_message", { roomId, content }).catch((e) => ({ ok: false, message: e.message }));
      check("send_message ack ok", sendAck?.ok === true, JSON.stringify(sendAck));
      try {
        const [msg] = await received;
        check(
          "B receives realtime message with correct sender/content",
          msg?.content === content && msg?.senderId === idA && msg?.roomId === roomId,
          JSON.stringify(msg)
        );
      } catch (err) {
        check("B receives realtime message with correct sender/content", false, err.message);
      }

      const history = await B.fetch(`/api/chat/rooms/${roomId}/messages`);
      const found = history.body?.messages?.some((m) => m.content === content && m.senderId === idA);
      check("REST message history contains the message", history.status === 200 && found, `status=${history.status} count=${history.body?.messages?.length}`);
    }
  }

  // --------------------------------------- 5/6. reports → dormant + socket kick
  section("5/6. Reports → dormant transition (+ live socket force-disconnect)");
  {
    const sc = await C.signup(nameC);
    const sd = await D.signup(nameD);
    if (sc.status !== 201 || sd.status !== 201) throw new Error("signup C/D failed");
    const idC = sc.body.user.id;

    // C keeps a live socket open — the review C-1 regression target.
    let socketC = null;
    let disconnectReason = null;
    const disconnected = new Promise((resolve) => {
      connectSocket(C)
        .then((s) => {
          socketC = s;
          s.on("disconnect", (reason) => {
            disconnectReason = reason;
            resolve(reason);
          });
        })
        .catch(() => resolve(null));
    });
    // Give the connection a moment to establish.
    await new Promise((r) => setTimeout(r, 300));
    check("C has a live Socket.IO connection before reports", !!socketC?.connected, `id=${socketC?.id}`);

    const reason = `E2E 신고 사유 - 자동화 검증용 (${RUN})`;
    // 대상 환경의 USER_REPORT_THRESHOLD에 맞춰 신고자 수를 조절한다
    // (dev .env는 3, 배포 .env.example 기본값은 5).
    const threshold = Number(process.env.VERIFY_USER_REPORT_THRESHOLD || "3");
    const reporters = [A, B, D];
    for (let i = reporters.length; i < threshold; i++) {
      const extra = new Client(`R${i}`);
      const se = await extra.signup(`e2e_r${i}_${RUN}`);
      if (se.status !== 201) throw new Error(`signup extra reporter R${i} failed`);
      reporters.push(extra);
    }
    const reps = [];
    for (const r of reporters.slice(0, threshold)) {
      reps.push(await r.json("POST", "/api/reports", { targetType: "user", targetId: idC, reason }));
    }
    check(
      `${threshold} distinct reporters → all 201 (threshold=${threshold})`,
      reps.every((r) => r.status === 201),
      reps.map((r) => r.status).join("/")
    );

    const meC = await C.fetch("/api/users/me");
    check("dormant user's REST request → 401", meC.status === 401, `status=${meC.status}`);

    const kicked = await Promise.race([disconnected, new Promise((r) => setTimeout(() => r("timeout"), 5000))]);
    check(
      "live socket force-disconnected by server (io server disconnect)",
      kicked === "io server disconnect",
      `reason=${disconnectReason ?? kicked}`
    );
    if (socketC?.connected) socketC.close();

    // 6. duplicate report by the same reporter → 409 (unique constraint).
    const dupRep = await A.json("POST", "/api/reports", { targetType: "user", targetId: idC, reason });
    check("same reporter re-reports same target → 409", dupRep.status === 409, `status=${dupRep.status} body=${JSON.stringify(dupRep.body)}`);
  }

  socketA?.close();
  socketB?.close();

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (failures.length) {
    console.log("Failed checks:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFatal error while running E2E verification:", err);
  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed (aborted) ===`);
  process.exit(1);
});
