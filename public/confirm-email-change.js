const form = document.querySelector("#confirm-email-change-form");
const message = document.querySelector("#confirm-email-change-message");
const success = document.querySelector("#confirm-email-change-success");
const pageUrl = new URL(window.location.href);
const token = pageUrl.searchParams.get("token") || "";
window.history.replaceState({}, "", pageUrl.pathname);

if (!token) {
  form.hidden = true;
  message.textContent = "This email change link is invalid or has expired.";
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
    const response = await fetch("/api/auth/confirm-email-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: values.get("password") }),
    });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(data?.error || "Could not confirm the email change");

    form.reset();
    form.hidden = true;
    success.hidden = false;
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
    button.disabled = false;
  }
});
