import { getConfig } from "./config.ts";

interface GlobalOptions {
  apiUrl?: string;
  tenantId?: string;
  token?: string;
}

let globalOptions: GlobalOptions = {};

export function setGlobalOptions(opts: GlobalOptions): void {
  globalOptions = { ...opts };
}

export function getGlobalOptions(): GlobalOptions {
  return { ...globalOptions };
}

interface ApiRequestOptions {
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

interface ApiError extends Error {
  status: number;
  detail: string;
}

function createApiError(message: string, status: number): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  err.detail = message;
  return err;
}

export async function apiClient(
  method: string,
  path: string,
  options?: ApiRequestOptions
): Promise<any> {
  const baseUrl =
    globalOptions.apiUrl || getConfig("api_url") || "https://api-dev.simplefi.tech";
  const token = globalOptions.token || getConfig("token");
  const tenantId = globalOptions.tenantId || getConfig("tenant_id");

  // Build URL with query params
  let url = `${baseUrl}${path}`;
  if (options?.params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value));
      }
    }
    const qs = searchParams.toString();
    if (qs) {
      url += `?${qs}`;
    }
  }

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (tenantId) {
    headers["X-Tenant-Id"] = tenantId;
  }

  // Build request
  const init: RequestInit = {
    method: method.toUpperCase(),
    headers,
  };

  if (options?.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    if (response.status === 401) {
      throw createApiError(
        "Session expired. Please run `edgeos login`",
        401
      );
    }

    // Try to parse error detail
    let detail = `Request failed with status ${response.status}`;
    try {
      const errorBody = await response.json();
      if (typeof errorBody.detail === "string") {
        detail = errorBody.detail;
      } else if (Array.isArray(errorBody.detail)) {
        detail = errorBody.detail
          .map((d: any) => d.msg || JSON.stringify(d))
          .join("; ");
      }
    } catch {
      // If we can't parse JSON, use the status text
      detail = response.statusText || detail;
    }

    throw createApiError(detail, response.status);
  }

  // Handle empty responses (204, etc.)
  const contentType = response.headers.get("content-type");
  if (
    response.status === 204 ||
    !contentType?.includes("application/json")
  ) {
    return null;
  }

  return response.json();
}

export async function apiGet(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<any> {
  return apiClient("GET", path, { params });
}

export async function apiPost(
  path: string,
  body?: unknown,
  params?: Record<string, string | number | boolean | undefined>
): Promise<any> {
  return apiClient("POST", path, { body, params });
}

export async function apiPatch(
  path: string,
  body?: unknown,
  params?: Record<string, string | number | boolean | undefined>
): Promise<any> {
  return apiClient("PATCH", path, { body, params });
}

export async function apiDelete(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<any> {
  return apiClient("DELETE", path, { params });
}
