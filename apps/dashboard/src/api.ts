const BASE = "/api/v1";

export function getToken(): string | null {
  return localStorage.getItem("pv_token");
}

export function setSession(token: string, user: unknown) {
  localStorage.setItem("pv_token", token);
  localStorage.setItem("pv_user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("pv_token");
  localStorage.removeItem("pv_user");
}

export function getUser(): { email: string; role: string; tenantName: string } | null {
  const raw = localStorage.getItem("pv_user");
  return raw ? JSON.parse(raw) : null;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearSession();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
