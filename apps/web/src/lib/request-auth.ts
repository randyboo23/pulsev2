import "server-only";

type HeaderSecret = {
  headerName: string;
  secret: string | undefined;
};

type SecretAuthOptions = {
  headerSecrets?: HeaderSecret[];
  bearerSecrets?: Array<string | undefined>;
};

export function isSecretAuthorized(request: Request, options: SecretAuthOptions) {
  for (const { headerName, secret } of options.headerSecrets ?? []) {
    if (!secret) continue;
    if (request.headers.get(headerName) === secret) return true;
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch?.[1]?.trim();
  if (!bearerToken) return false;

  for (const secret of options.bearerSecrets ?? []) {
    if (!secret) continue;
    if (bearerToken === secret) return true;
  }

  return false;
}
