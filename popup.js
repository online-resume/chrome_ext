// The popup: reads the open page (extract.js, injected on this click only), shows what it found and
// lets the user send it to AI Resume Builder as a role (POST /api/roles/clip), download everything
// as JSON, or copy the text. The app is called with the browser's own login cookie: the extension
// stores no password, only the app's address (chrome.storage).

const DEFAULT_BASE = "http://localhost:8000";
const MIN_TEXT = 200;   // the app refuses less: it cannot be a job description (serve.CLIP_MIN)
const $ = (id) => document.getElementById(id);

let page = null;   // what extract.js returned for the open tab
let base = DEFAULT_BASE;

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
    ["job", "The job description found in the page's data", page.text.job],
    ["main", "The main part of the page", page.text.main],
    ["full", "The whole page", page.text.full],
  ];
  // a part the page does not have, or one that repeats the one before it, is not offered
  return options.filter(([, , text], i) => text && text.length >= MIN_TEXT && !options.slice(0, i).some(([, , t]) => t === text));
}

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
    + (page.job ? ", job details" : "");
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
  $("page").hidden = false;
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
    response = await fetch(`${base}/api/roles/clip`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: page.url, title: page.title, text: $("text").value.trim(),
        job_title: $("job-title").value.trim(), company_name: $("company").value.trim(), location: $("location").value.trim(),
      }),
    });
  } catch {
    button.disabled = false;
    $("settings").open = true;
    return say(`AI Resume Builder did not answer at ${base}. Start it, or change its address in Settings below.`, "bad");
  }
  button.disabled = false;
  const answer = await response.json().catch(() => ({}));
  if (response.status === 401) {
    return say("Log in to AI Resume Builder in this browser, then send again.", "bad", { label: "Open the login page", run: openApp });
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
  base = url.origin;
  $("base").value = base;
  await chrome.storage.local.set({ base });
  say("Address saved.", "good");
}

async function start() {
  base = (await chrome.storage.local.get("base")).base || DEFAULT_BASE;
  $("base").value = base;
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
    $("problem").hidden = false;
  }
}

start();
