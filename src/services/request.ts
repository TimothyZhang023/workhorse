/**
 * HTTP request utility — replaces `request` from @umijs/max.
 *
 * A thin wrapper around fetch that:
 * - Auto-attaches Bearer token from localStorage
 * - Parses JSON responses
 * - Throws on non-ok responses
 */

const DEFAULT_DESKTOP_API_ORIGIN = "http://127.0.0.1:8080";

interface RequestOptions extends Omit<RequestInit, "body"> {
  method?: string;
  data?: any;
  params?: Record<string, any>;
  timeout?: number;
}

function getConfiguredApiBaseUrl() {
  const envBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();
  if (envBaseUrl) {
    return envBaseUrl.replace(/\/$/, "");
  }

  if (typeof window === "undefined") {
    return "";
  }

  const protocol = window.location.protocol;
  if (protocol === "http:" || protocol === "https:") {
    return "";
  }

  return DEFAULT_DESKTOP_API_ORIGIN;
}

export function resolveApiUrl(url: string) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const baseUrl = getConfiguredApiBaseUrl();
  if (!baseUrl) {
    return url;
  }

  return new URL(url, `${baseUrl}/`).toString();
}

export function createAuthHeaders() {
  const headers: Record<string, string> = {};

  if (typeof localStorage === "undefined") {
    return headers;
  }

  const token = localStorage.getItem("token");
  if (!token) {
    return headers;
  }

  headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function request<T = any>(
  url: string,
  options: RequestOptions = {}
): Promise<T> {
  const {
    method = "GET",
    data,
    params,
    timeout = 10000,
    headers: customHeaders,
    ...rest
  } = options;

  // Build URL with query params
  let fullUrl = resolveApiUrl(url);
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const qs = searchParams.toString();
    if (qs) {
      fullUrl += `${fullUrl.includes("?") ? "&" : "?"}${qs}`;
    }
  }

  // Build headers
  const headers: Record<string, string> = {
    ...(customHeaders as Record<string, string>),
    ...createAuthHeaders(),
  };

  // Build body
  let body: BodyInit | undefined;
  if (data !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(data);
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(fullUrl, {
      method,
      headers,
      body,
      signal: controller.signal,
      ...rest,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `Request failed (${response.status})`;
      try {
        const errorData = await response.json();
        errorMessage =
          errorData?.error?.message ||
          errorData?.error ||
          errorData?.message ||
          errorMessage;
      } catch {
        // Ignore parse errors
      }
      throw new Error(errorMessage);
    }

    // Handle empty responses
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }

    return (await response.text()) as unknown as T;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("请求超时");
    }
    throw error;
  }
}
