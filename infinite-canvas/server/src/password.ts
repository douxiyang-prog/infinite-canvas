import { HttpError } from "./http";

const USERNAME_PATTERN = /^[\p{L}\p{N}._-]{3,64}$/u;

export function validateUsername(username: string) {
  const value = username.trim();
  if (!USERNAME_PATTERN.test(value)) {
    throw new HttpError(
      400,
      "用户名需为 3–64 个字符，仅支持文字、数字、点、下划线和连字符",
    );
  }
  return value;
}

export function validateDisplayName(displayName: string) {
  const value = displayName.trim();
  if (value.length < 1 || value.length > 100)
    throw new HttpError(400, "显示名称需为 1–100 个字符");
  return value;
}

export function validatePassword(password: string) {
  if (password.length < 10 || password.length > 200) {
    throw new HttpError(400, "密码长度需为 10–200 个字符");
  }
  return password;
}

export function hashPassword(password: string) {
  return Bun.password.hash(validatePassword(password), {
    algorithm: "argon2id",
    memoryCost: 65536,
    timeCost: 3,
  });
}

export function verifyPassword(password: string, hash: string) {
  return Bun.password.verify(password, hash);
}
