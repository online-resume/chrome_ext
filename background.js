// The extension's background worker. watch.js (the box on job sites) cannot call the app itself:
// a script inside a page is held to the browser's cross-site rules. It asks here instead, and this
// worker sends the job as the signed-in user (the address and token popup.js saved).
//
// Message {type: "rb-send", job: {url, title, text, job_title, company_name, location, apply_url}}
//   -> {status, answer}: the app's HTTP status and JSON answer; status 0 = the app did not answer,
//      401 = nobody is signed in (or the sign-in ended: it is then forgotten, as in the popup)

const DEFAULT_BASE = "http://localhost:8000";
const FIELDS = ["url", "title", "text", "job_title", "company_name", "location", "apply_url"];

async function send(job) {
  const { base, token } = await chrome.storage.local.get(["base", "token"]);
  if (!token) return { status: 401, answer: {} };
  // only the known fields, as text: nothing else a page could have slipped in reaches the app
  const body = Object.fromEntries(FIELDS.map((name) => [name, String(job?.[name] ?? "")]));
  let response;
  try {
    response = await fetch(`${base || DEFAULT_BASE}/api/roles/clip`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 0, answer: {} };
  }
  if (response.status === 401) await chrome.storage.local.remove(["token", "user"]);
  return { status: response.status, answer: await response.json().catch(() => ({})) };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // only this extension's own scripts are answered
  if (sender.id !== chrome.runtime.id || message?.type !== "rb-send") return false;
  send(message.job).then(respond);
  return true;   // the answer comes later
});
