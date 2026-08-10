export function normalizeRegistration(body) {
  const email = normalizeEmail(body?.email);
  const password = normalizePassword(body?.password);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (name.length > 80) throw new Error("Name must be no longer than 80 characters");
  return { email, password, name };
}

export function normalizeLogin(body) {
  return {
    email: normalizeEmail(body?.email),
    password: normalizePassword(body?.password),
  };
}

export function normalizePasswordResetRequest(body) {
  return { email: normalizeEmail(body?.email) };
}

export function normalizePasswordResetConfirmation(body) {
  const token = normalizeAuthToken(
    body?.token,
    "This password reset link is invalid or has expired",
  );
  const password = normalizePassword(body?.password);
  if (password !== body?.passwordConfirm) throw new Error("Passwords do not match");
  return { token, password };
}

export function normalizeVerificationRequest(body) {
  return { email: normalizeEmail(body?.email) };
}

export function normalizeEmailVerificationConfirmation(body) {
  return {
    token: normalizeAuthToken(
      body?.token,
      "This email verification link is invalid or has expired",
    ),
  };
}

export function normalizeEmailChangeConfirmation(body) {
  return {
    token: normalizeAuthToken(
      body?.token,
      "This email change link is invalid or has expired",
    ),
    password: normalizePassword(body?.password),
  };
}

function normalizeEmail(value) {
  if (typeof value !== "string") throw new Error("Enter your email address");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address");
  }
  return email;
}

function normalizePassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 72) {
    throw new Error("Password must be between 8 and 72 characters");
  }
  return value;
}

function normalizeAuthToken(value, message) {
  if (
    typeof value !== "string" ||
    value.length < 20 ||
    value.length > 2_048 ||
    !/^[A-Za-z0-9._-]+$/.test(value)
  ) {
    throw new Error(message);
  }
  return value;
}

export function publicUser(record) {
  return {
    id: record.id,
    email: record.email,
    name: record.name || "",
  };
}
