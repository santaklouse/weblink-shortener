const form = document.querySelector("#forgot-password-form");
const message = document.querySelector("#forgot-password-message");
const success = document.querySelector("#forgot-password-success");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  message.classList.remove("error");
  const button = form.querySelector("button");
  button.disabled = true;

  try {
    const values = new FormData(form);
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: values.get("email") }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not request a password reset");

    form.hidden = true;
    success.hidden = false;
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
    button.disabled = false;
  }
});
