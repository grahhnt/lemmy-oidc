const $pagesWrapper = document.querySelector("form.pages-wrapper");
const $instancePage = document.querySelector("#instance-select");
const $instanceTxt = document.querySelector(
  "#instance-select input[name=instance]"
);
const $usernameTxt = document.querySelector("#login input[name=login]");
const $passwordTxt = document.querySelector("#login input[name=password]");
const $totpTxt = document.querySelector("#login input[name=totp]");
const $checkDomainBtn = document.querySelector(
  "#instance-select .check-instance"
);
const $activeInstanceBtn = document.querySelector("#active-instance");
const $activeInstanceIcon = document.querySelector(
  "#active-instance .instance-icon"
);
const $activeInstanceName = document.querySelector(
  "#active-instance .instance-name-display"
);
const $activeInstanceURL = document.querySelector(
  "#active-instance .instance-url"
);
const $errors = document.querySelector(".errors");
const $form = document.querySelector("form");

let software = {
  name: "",
  version: "",
};

const showError = (title, body) => {
  const errorBox = document.createElement("div");
  errorBox.classList.add("error-box");
  errorBox.innerHTML = `<strong>${title}</strong>`;
  if (body) {
    const details = document.createElement("p");
    details.innerText = body;
    errorBox.append(details);
  }

  const dismiss = document.createElement("a");
  dismiss.setAttribute("href", "#");
  dismiss.addEventListener("click", (e) => {
    e.preventDefault();
    errorBox.remove();
  });
  dismiss.innerText = "Dismiss";
  errorBox.append(dismiss);

  $errors.append(errorBox);
};

const gotoPage = (page) => {
  if (page === "instance") {
    $pagesWrapper.scrollLeft = 0;
    $instanceTxt.focus();
  } else {
    $pagesWrapper.scrollLeft = $instancePage.clientWidth;
    $usernameTxt.focus();
  }
};

gotoPage("instance");

$activeInstanceBtn.addEventListener("click", (e) => {
  e.preventDefault();
  gotoPage("instance");
});

/**
 * @property {object} software
 * @property {string} software.name
 * @property {string} software.version
 * @property {object} meta
 * @property {string?} meta.name
 * @property {string?} meta.icon
 */
let instance = {};
let checkingInstance = false;

$instanceTxt.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $checkDomainBtn.click();
  }
});

$activeInstanceURL.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && e.shiftKey) {
    e.preventDefault();
  }
});

$checkDomainBtn.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && !e.shiftKey) {
    e.preventDefault();
  }
});

$checkDomainBtn.addEventListener("click", async function (e) {
  e.preventDefault();

  if (checkingInstance) return;
  checkingInstance = true;
  $checkDomainBtn.innerText = "Loading...";

  const HOST = $instanceTxt.value.replace(/https?:\/\//gi, "").split("/")[0];
  if (!HOST?.length) {
    showError("Missing host");
    checkingInstance = false;
    $checkDomainBtn.innerText = "Next";
    return;
  }

  const software = await fetch("/api/get-software?domain=" + HOST).then((a) =>
    a.json()
  );

  if (!software.success) {
    showError("Error", software.error);
    checkingInstance = false;
    $checkDomainBtn.innerText = "Next";
    return;
  }

  instance = software;

  $activeInstanceIcon.setAttribute("src", instance.meta.icon);
  $activeInstanceIcon.setAttribute("alt", `${instance.meta.name} Lemmy Logo`);
  $activeInstanceName.innerText = instance.meta.name;
  $activeInstanceURL.innerText = `(${HOST})`;
  $activeInstanceURL.setAttribute("href", `https://${HOST}`);

  gotoPage("login");
  checkingInstance = false;
  $checkDomainBtn.innerText = "Next";
});

$form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const data = new URLSearchParams();
  for (const pair of new FormData($form)) {
    data.append(pair[0], pair[1]);
  }

  const loginattempt = await fetch($form.getAttribute("action"), {
    method: "POST",
    body: data,
  }).then((a) => a.json());

  if (loginattempt.error === "totp_token") {
    showError("Login Error", "2FA token missing or invalid");
    $totpTxt.removeAttribute("style");
    return;
  }

  if (!loginattempt.success) {
    showError("Login Error", loginattempt.error);
    return;
  }

  window.location.href = loginattempt.redirect;
});
