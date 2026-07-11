const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class ApiError extends Error {
  status: number;
  details?: Record<string, string[] | undefined>;

  constructor(status: number, message: string, details?: Record<string, string[] | undefined>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let csrfToken: string | null = null;
let csrfTokenPromise: Promise<string> | null = null;

// Fetches (and caches) the double-submit CSRF token; see backend
// src/middleware/csrf.ts for the matching server-side check.
async function ensureCsrfToken(forceRefresh = false): Promise<string> {
  if (csrfToken && !forceRefresh) return csrfToken;
  if (!csrfTokenPromise || forceRefresh) {
    csrfTokenPromise = fetch(`${API_BASE_URL}/api/csrf-token`, { credentials: "include" })
      .then((res) => res.json())
      .then((data: { csrfToken: string }) => {
        csrfToken = data.csrfToken;
        return data.csrfToken;
      });
  }
  return csrfTokenPromise;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  isFormData?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}, retryOnCsrfFailure = true): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    if (options.isFormData) {
      body = options.body as FormData;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
  }

  if (!SAFE_METHODS.has(method)) {
    headers["X-CSRF-Token"] = await ensureCsrfToken();
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body,
    credentials: "include",
  });

  if (res.status === 403 && retryOnCsrfFailure && !SAFE_METHODS.has(method)) {
    // Token may have expired/rotated (e.g. after login regenerated the
    // session) — refresh once and retry before surfacing an error.
    await ensureCsrfToken(true);
    return request<T>(path, options, false);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "요청에 실패했습니다.", data?.details);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  postForm: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: "POST", body: formData, isFormData: true }),
};

export { ensureCsrfToken, API_BASE_URL };
