export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders,
  });
}

export async function readJson(
  request: Request,
): Promise<Record<string, unknown>> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  ) {
    throw new HttpError(415, "请求必须使用 application/json");
  }
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "JSON 请求格式不正确");
  }
}

export function textField(
  body: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim())
    throw new HttpError(400, `请填写${label}`);
  return value.trim();
}

export function optionalTextField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${key} 格式不正确`);
  return value.trim();
}

export function passwordField(
  body: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = body[key];
  if (typeof value !== "string" || !value)
    throw new HttpError(400, `请填写${label}`);
  return value;
}

export function optionalPasswordField(
  body: Record<string, unknown>,
  key: string,
) {
  const value = body[key];
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${key} 格式不正确`);
  return value;
}
