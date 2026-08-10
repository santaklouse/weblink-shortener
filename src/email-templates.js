function applicationOrigin(value) {
  if (!value) throw new Error("PUBLIC_BASE_URL is required for authentication email links");

  const url = new URL(value);
  if (!(["http:", "https:"].includes(url.protocol))) {
    throw new Error("PUBLIC_BASE_URL must use HTTP or HTTPS");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_BASE_URL must contain only the public application origin");
  }
  return url.origin;
}

export function buildAuthEmailTemplates(publicBaseUrl) {
  const appUrl = applicationOrigin(publicBaseUrl);

  return {
    verificationTemplate: {
      subject: "Verify your {APP_NAME} email",
      body: `<p>Hello,</p>
<p>Thank you for creating a {APP_NAME} account.</p>
<p><a class="btn" href="${appUrl}/verify-email?token={TOKEN}" target="_blank" rel="noopener">Verify email</a></p>
<p><i>If you did not create this account, you can ignore this email.</i></p>
<p>Thanks,<br>{APP_NAME} team</p>`,
    },
    resetPasswordTemplate: {
      subject: "Reset your {APP_NAME} password",
      body: `<p>Hello,</p>
<p>Click the button below to choose a new password.</p>
<p><a class="btn" href="${appUrl}/reset-password?token={TOKEN}" target="_blank" rel="noopener">Reset password</a></p>
<p><i>If you did not request a password reset, you can ignore this email.</i></p>
<p>Thanks,<br>{APP_NAME} team</p>`,
    },
    confirmEmailChangeTemplate: {
      subject: "Confirm your new {APP_NAME} email address",
      body: `<p>Hello,</p>
<p>Click the button below to confirm your new email address.</p>
<p><a class="btn" href="${appUrl}/confirm-email-change?token={TOKEN}" target="_blank" rel="noopener">Confirm new email</a></p>
<p><i>If you did not request this change, you can ignore this email.</i></p>
<p>Thanks,<br>{APP_NAME} team</p>`,
    },
  };
}
