// The popup: reads the open page (extract.js, injected on this click only), shows what it found and
// lets the user send it to AI Resume Builder as a role (POST /api/roles/clip), download everything
// as JSON, or copy the text. The user signs in here with their app username and password
// (POST /api/extension/login); the app answers with a session token, which is kept with the app's
// address in chrome.storage and sent as `Authorization: Bearer`. The password is never kept. Each
// user of the extension so works as their own app user, whoever is logged in to the app's page.

const DEFAULT_BASE = "http://localhost:8000";
const MIN_TEXT = 200;   // the app refuses less: it cannot be a job description (serve.CLIP_MIN)
const $ = (id) => document.getElementById(id);

let page = null;   // what extract.js returned for the open tab
let base = DEFAULT_BASE;
let token = "";    // the signed-in user's session token ("" = signed out)

// A call to the app as the signed-in user. The browser's own cookies are left out, so the app
// sees only the extension's user.
const call = (path, body) => fetch(`${base}${path}`, {
  method: "POST",
  credentials: "omit",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

// Signed in: the page's data and the buttons. Signed out: the sign-in form (with `why` above it).
function showUser(user, why = "") {
  $("who").textContent = user || "";
  $("who").hidden = $("sign-out").hidden = !user;
  $("sign-in").hidden = Boolean(user);
  $("page").hidden = !user || !page;
  $("problem").hidden = !user || Boolean(page) || !$("problem").textContent;
  $("sign-in-status").textContent = why;
  $("sign-in-status").hidden = !why;
  if (!user) $("username").focus();
}

async function signOut(why = "") {
  token = "";
  await chrome.storage.local.remove(["token", "user"]);
  showUser("", typeof why === "string" ? why : "");
}

async function signIn(event) {
  event.preventDefault();
  const button = $("sign-in").querySelector("button");
  button.disabled = true;
  let response;
  try {
    response = await call("/api/extension/login", { username: $("username").value.trim(), password: $("password").value });
  } catch {
    $("settings").open = true;
    return showUser("", `AI Resume Builder did not answer at ${base}. Start it, or change its address in Settings below.`);
  } finally {
    button.disabled = false;
  }
  const answer = await response.json().catch(() => ({}));
  if (!response.ok || !answer.token) {
    return showUser("", answer.error || (response.status === 404
      ? "This AI Resume Builder is older than the extension. Restart the app, then sign in again."
      : `Sign-in failed (error ${response.status}).`));
  }
  token = answer.token;
  $("password").value = "";
  await chrome.storage.local.set({ token, user: answer.username });
  showUser(answer.username);
}

function say(text, kind = "", action = null) {
  const box = $("status");
  box.textContent = text;
  box.className = `note ${kind}`.trim();
  box.hidden = !text;
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", action.run);
    box.append(button);
  }
}

const openApp = () => chrome.tabs.create({ url: base });

function parts() {
  const options = [
    ["selection", "The text I selected", page.selection],
    ["panel", "Only the job that is open on this page", page.text.panel],
    ["job", "The job description found in the page's data", page.text.job],
    ["main", "The main part of the page", page.text.main],
    ["full", "The whole page", page.text.full],
  ];
  // a part the page does not have, or one that repeats the one before it, is not offered
  return options.filter(([, , text], i) => text && text.length >= MIN_TEXT && !options.slice(0, i).some(([, , t]) => t === text));
}

// On a page that lists many postings the page's own title names the search, not the job.
const roleName = () => [$("job-title").value.trim(), $("company").value.trim()].filter(Boolean).join(" - ");

function showSize() {
  const length = $("text").value.trim().length;
  $("size").textContent = `${length.toLocaleString()} characters`
    + (length < MIN_TEXT ? " - too short to be a job description" : "");
  $("send").disabled = length < MIN_TEXT;
}

function showPage() {
  $("page-title").textContent = page.title || page.url;
  $("page-title").title = page.url;
  const c = page.counts;
  $("found").textContent = `Found: ${c.words.toLocaleString()} words, ${c.links} links, ${c.images} images, ${c.tables} tables`
    + (page.text.panel ? ". Only the open job will be sent, not the list beside it." : page.job ? ", job details" : "")
    + (page.apply ? ` Apply link found (${page.apply.label}).` : " No apply link found; the job's page is kept as the link.");
  $("job-title").value = page.job?.title || "";
  $("company").value = page.job?.company || "";
  $("location").value = page.job?.location || "";
  const select = $("part");
  const available = parts();
  for (const [value, label] of available) select.append(new Option(label, value));
  if (!available.length) select.append(new Option("The whole page", "full"));
  const use = () => {
    $("text").value = select.value === "selection" ? page.selection : page.text[select.value] || "";
    showSize();
  };
  select.addEventListener("change", use);
  use();
}

async function readPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) {
    throw new Error("This is not a web page. Open a job posting (or any website) and click the icon again.");
  }
  try {
    const [injected] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extract.js"] });
    if (!injected?.result) throw new Error("empty");
    return injected.result;
  } catch {
    throw new Error("Chrome does not let extensions read this page (its own pages, the Web Store and PDF files are closed).");
  }
}

async function send() {
  const button = $("send");
  button.disabled = true;
  say("Sending, and finding the profile that fits best. This takes a few seconds…");
  let response;
  try {
    response = await call("/api/roles/clip", {
      url: page.url, title: roleName() || page.title, text: $("text").value.trim(),
      job_title: $("job-title").value.trim(), company_name: $("company").value.trim(), location: $("location").value.trim(),
      apply_url: page.apply?.url || "",
    });
  } catch {
    button.disabled = false;
    $("settings").open = true;
    return say(`AI Resume Builder did not answer at ${base}. Start it, or change its address in Settings below.`, "bad");
  }
  button.disabled = false;
  const answer = await response.json().catch(() => ({}));
  if (response.status === 401) {   // 7 days passed, or the password or the account changed
    say("");
    return signOut("Your sign-in has ended. Sign in again, then send.");
  }
  if (!response.ok) return say(answer.error || `The app refused the page (error ${response.status}).`, "bad");
  const open = { label: "Open AI Resume Builder", run: openApp };
  if (answer.already) return say("You already sent this page. It is in Email JDs.", "good", open);
  if (!answer.profile) {
    return say("Saved, but none of your profiles fits it. In Email JDs you can give it to a profile yourself.", "", open);
  }
  say(`Saved for your profile “${answer.profile_name || answer.profile}” (fit ${Math.round((answer.fit || 0) * 100)}%). It is in Email JDs, ready to optimize.`, "good", open);
}

function download() {
  const name = (page.title || "page").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "page";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(page, null, 2)], { type: "application/json" }));
  link.download = `${name}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  say("Saved to your Downloads folder.", "good");
}

async function copy() {
  await navigator.clipboard.writeText($("text").value);
  say("Copied.", "good");
}

async function saveBase() {
  let url;
  try {
    url = new URL($("base").value.trim() || DEFAULT_BASE);
    if (!/^https?:$/.test(url.protocol)) throw new Error("not a web address");
  } catch {
    return say("That is not a web address. Example: http://localhost:8000", "bad");
  }
  // Chrome asks the user before the extension may call an address other than this computer's
  if (!["localhost", "127.0.0.1"].includes(url.hostname) && !await chrome.permissions.request({ origins: [`${url.origin}/*`] })) {
    return say("Without that permission the extension cannot reach this address.", "bad");
  }
  const moved = url.origin !== base;
  base = url.origin;
  $("base").value = base;
  await chrome.storage.local.set({ base });
  if (moved) return signOut("Address saved. Sign in to the app at this address.");   // a sign-in belongs to one app
  if (token) say("Address saved.", "good");
}

async function start() {
  const saved = await chrome.storage.local.get(["base", "token", "user"]);
  base = saved.base || DEFAULT_BASE;
  token = saved.token || "";
  $("base").value = base;
  $("sign-in").addEventListener("submit", signIn);
  $("sign-out").addEventListener("click", signOut);
  $("open-app").addEventListener("click", openApp);
  $("save-base").addEventListener("click", saveBase);
  $("text").addEventListener("input", showSize);
  $("send").addEventListener("click", send);
  $("download").addEventListener("click", download);
  $("copy").addEventListener("click", copy);
  try {
    page = await readPage();
    showPage();
  } catch (err) {
    $("problem").textContent = err.message;
  }
  showUser(token ? saved.user || "Signed in" : "");
}

start();
