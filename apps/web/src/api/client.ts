export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

/** 応答が返らなかった（圏外・回線断・時間切れ）。
 * ApiError と違いサーバーの返事が無いので、再試行を案内するために区別する */
export class NetworkError extends Error {
  constructor(
    /** 時間切れ（打ち切り）なら true。単なる回線断と案内を変えるため */
    public timedOut: boolean,
    cause?: unknown,
  ) {
    super(timedOut ? "request timed out" : "network error");
    this.cause = cause;
  }
}

export interface RequestOptions {
  /** 応答を待つ上限（ミリ秒）。会場の電波が悪いときに画面が固まったままに
   * ならないよう、返事を待ち続けない呼び出しで指定する。
   * 既定では打ち切らない（画像アップロード等の長い処理を巻き込まないため） */
  timeoutMs?: number;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: RequestOptions,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
      signal: opts?.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    });
  } catch (e) {
    // fetch が投げるのは回線断か打ち切り。どちらもサーバーの返事は無い
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    throw new NetworkError(timedOut, e);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) =>
    request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>("POST", path, body, opts),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};
