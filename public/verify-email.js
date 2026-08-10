const form = document.querySelector("#resend-verification-form");
const message = document.querySelector("#verify-email-message");
const success = document.querySelector("#verify-email-success");
const successTitle = document.querySelector("#verify-email-success-title");
const successText = document.querySelector("#verify-email-success-text");
const pageUrl = new URL(window.location.href);
const token = pageUrl.searchParams.get("token") || "";
const registrationStatus = pageUrl.searchParams.get("status") || "";
window.history.replaceState({}, "", pageUrl.pathname);

function showSuccess(title, text) {
  successTitle.textContent = title;
  successText.textContent = text;
  success.hidden = false;
}

async function confirmVerification() {
  form.hidden = true;
  message.textContent = "Verifying your email…";

  try {
    const response = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(data?.error || "Could not verify the email address");

    message.textContent = "";
    showSuccess("Email verified", "Your account is ready. You can now sign in.");
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
    form.hidden = false;
  }
}

if (token) {
  confirmVerification();
} else if (registrationStatus === "sent") {
  showSuccess(
    "Check your inbox",
    "We sent a verification link to your email address. Check your spam folder if it does not arrive.",
  );
} else if (registrationStatus === "delivery-failed") {
  message.textContent = "Your account was created, but the verification email could not be sent. Try again below.";
  message.classList.add("error");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  message.classList.remove("error");
  success.hidden = true;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    const values = new FormData(form);
    const response = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: values.get("email") }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not request a verification email");

    form.hidden = true;
    showSuccess(
      "Check your inbox",
      "If an unverified account exists for that email, a verification link has been sent.",
    );
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
    button.disabled = false;
  }
});
