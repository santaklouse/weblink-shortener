const form = document.querySelector("#reset-password-form");
const message = document.querySelector("#reset-password-message");
const success = document.querySelector("#reset-password-success");
const pageUrl = new URL(window.location.href);
const token = pageUrl.searchParams.get("token") || "";
window.history.replaceState({}, "", pageUrl.pathname);

if (!token) {
  form.hidden = true;
  message.textContent = "This password reset link is invalid or has expired.";
  message.classList.add("error");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  message.classList.remove("error");
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    const values = new FormData(form);
    const password = values.get("password");
    const passwordConfirm = values.get("passwordConfirm");
    if (password !== passwordConfirm) throw new Error("Passwords do not match");

    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password, passwordConfirm }),
    });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(data?.error || "Could not reset the password");

    form.reset();
    form.hidden = true;
    success.hidden = false;
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
    button.disabled = false;
  }
});
