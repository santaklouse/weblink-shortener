const showPasswordIcon = `
  <svg class="password-show-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path>
    <circle cx="12" cy="12" r="2.6"></circle>
  </svg>`;

const hidePasswordIcon = `
  <svg class="password-hide-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 3l18 18"></path>
    <path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16.7 16.7 0 0 1-2.2 2.9"></path>
    <path d="M6.2 6.2C3.8 7.9 2.5 12 2.5 12s3.5 6 9.5 6c1.4 0 2.7-.3 3.8-.8"></path>
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path>
  </svg>`;

function setPasswordVisible(input, button, visible) {
  input.type = visible ? "text" : "password";
  button.setAttribute("aria-pressed", String(visible));
  button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  button.title = visible ? "Hide password" : "Show password";
}

document.querySelectorAll("input[data-password-toggle]").forEach((input) => {
  const wrapper = document.createElement("div");
  wrapper.className = "password-field";
  input.before(wrapper);
  wrapper.append(input);

  const button = document.createElement("button");
  button.className = "password-visibility-toggle";
  button.type = "button";
  button.setAttribute("aria-controls", input.id);
  button.innerHTML = `${showPasswordIcon}${hidePasswordIcon}`;
  setPasswordVisible(input, button, false);
  wrapper.append(button);

  button.addEventListener("click", () => {
    setPasswordVisible(input, button, input.type === "password");
  });

  input.form?.addEventListener("reset", () => {
    queueMicrotask(() => setPasswordVisible(input, button, false));
  });
});
