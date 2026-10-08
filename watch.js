// Runs by itself on the job sites listed in manifest.json -> content_scripts (after extract.js and
// sponsorship.js). When a job is open on the page it shows a small box in the corner: "Send this
// job to AI Resume Builder?" with Send, Send + optimize (also queues it in the app's Applications,
// where a resume is made for it) and Not now. Nothing is sent until one of the two is pressed.
//
// The box is not shown: when nobody is signed in to the extension, when the offer is switched off
// (the popup's Settings), for a job this user already sent, and for a job they answered Not now
// (until the page is loaded again). These sites change the open job without loading a new page,
// so the page is looked at again every few seconds.
//
// A page's own scripts cannot call the app from here, and neither can this one (the browser's
// cross-site rules apply to it): Send asks background.js, which calls POST /api/roles/clip.
(() => {
  if (window.top !== window || globalThis.rbWatching) return;
  globalThis.rbWatching = true;

  const MIN_TEXT = 200;    // the app refuses less: it cannot be a job description (serve.CLIP_MIN)
  const EVERY_MS = 2000;
  const SENT_KEPT = 500;   // as in popup.js: the jobs remembered as sent
  const VISA_SAYS = { no: "Not offered", yes: "Offered", unknown: "Not mentioned" };
  const CSS = `
    :host { all: initial; }
    .box { box-sizing: border-box; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 360px; padding: 12px 14px;
      border: 1px solid #d5dceb; border-radius: 10px; background: #fff; color: #0f1b33;
      box-shadow: 0 8px 28px rgba(15, 27, 51, 0.22); font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .head { display: flex; align-items: start; gap: 8px; margin-bottom: 4px; font-weight: 600; }
    .head span { flex: 1; }
    .role { margin: 0 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .place { color: #33415c; font-size: 12px; }
    .visa { margin: 0 0 10px; padding: 4px 8px; border: 1px solid #d5dceb; border-radius: 6px; font-size: 12px; }
    .visa.no { border-color: #b3261e; background: #fdecea; color: #b3261e; }
    .visa.yes { border-color: #0f7a4a; background: #e3f6ec; color: #0f7a4a; }
    .row { display: flex; gap: 8px; }
    button { flex: 1 1 auto; white-space: nowrap; padding: 7px 8px; border: 1px solid #d5dceb; border-radius: 6px; background: #fff; color: #0f1b33; font: inherit; cursor: pointer; }
    button:hover { border-color: #1d4fd8; }
    button:focus-visible { outline: 2px solid #1d4fd8; outline-offset: 1px; }
    button.primary { border-color: #1d4fd8; background: #1d4fd8; color: #fff; font-weight: 600; }
    button.primary:disabled { opacity: 0.6; cursor: default; }
    button.close { flex: none; padding: 0 4px; border: 0; background: none; color: #33415c; font-size: 16px; line-height: 1; }
    .note { margin: 0; padding: 7px 9px; border-radius: 6px; background: #e8effe; }
    .note.good { background: #e3f6ec; color: #0f7a4a; }
    .note.bad { background: #fdecea; color: #b3261e; }
  `;

  const dismissed = new Set();   // jobs answered "Not now" on this page
  let host = null;               // the box's element on the page (its content is in a closed shadow root)
  let showing = "";              // the job the box is about ("" = no box)
  let busy = false;              // a send is on its way: the box stays as it is
  let told = "";                 // the job (address and title) whose box shows the answer to a send
  let timer = 0;

  const make = (tag, className = "", text = "") => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  function hide() {
    host?.remove();
    host = null;
    showing = told = "";
  }

  // The box for one job. The page's own styles do not reach inside it, and a style sheet object is
  // used because a page may forbid style elements added by scripts.
  function show(job, key) {
    hide();
    showing = key;
    host = make("div");
    const root = host.attachShadow({ mode: "closed" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    const box = make("div", "box");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Send this job to AI Resume Builder");

    const head = make("div", "head");
    const close = make("button", "close", "×");
    close.type = "button";
    close.title = "Not now";
    head.append(make("span", "", "Send this job to AI Resume Builder?"), close);

    const role = make("p", "role", [job.title, job.company].filter(Boolean).join(" - "));
    role.title = role.textContent;
    if (job.location) role.append(make("br"), make("span", "place", job.location));

    const found = globalThis.rbSponsorship(job.text);
    const visa = make("p", `visa ${found.status}`, `Visa sponsorship: ${VISA_SAYS[found.status]}`
      + (found.words ? ` - “${found.words}”` : ""));

    const row = make("div", "row");
    const send = make("button", "primary", "Send");
    const both = make("button", "", "Send + optimize");
    const later = make("button", "", "Not now");
    send.type = both.type = later.type = "button";
    send.title = "Saves the job in the app";
    both.title = "Also makes a resume for it in the background; it waits in the app under Applications, with the apply link";
    row.append(send, both, later);
    box.append(head, role, visa, row);
    root.append(box);
    document.documentElement.append(host);

    const notNow = () => { dismissed.add(key); hide(); };
    close.addEventListener("click", notNow);
    later.addEventListener("click", notNow);
    const go = (button, optimize) => button.addEventListener("click", async () => {
      busy = true;
      send.disabled = both.disabled = true;
      button.textContent = "Sending…";
      (optimize ? send : both).remove();
      later.remove();
      const [text, kind] = await deliver(job, key, optimize);
      busy = false;
      if (showing !== key) return;   // the box was closed meanwhile
      row.replaceWith(make("p", `note ${kind}`.trim(), text));
      told = `${job.url}|${job.title}`;   // the answer stays until another job is opened, whatever it was
      if (kind === "good") setTimeout(() => { if (showing === key && host) { host.remove(); host = null; } }, 8000);
    });
    go(send, false);
    go(both, true);
  }

  // Send the job through background.js; returns [what to tell the user, good | bad | ""].
  async function deliver(job, key, optimize) {
    let reply;
    try {
      reply = await chrome.runtime.sendMessage({ type: "rb-send", job: {
        url: job.url, title: [job.title, job.company].filter(Boolean).join(" - "), text: job.text,
        job_title: job.title, company_name: job.company, location: job.location, apply_url: job.apply?.url || "",
      }, optimize });
    } catch {
      return ["The extension was updated. Load this page again, then send.", "bad"];
    }
    const answer = reply?.answer || {};
    if (!reply || reply.status === 0) return ["AI Resume Builder did not answer. Is it running? Its address is in the extension's Settings.", "bad"];
    if (reply.status === 401) return ["Your sign-in has ended. Click the extension's icon and sign in, then send.", "bad"];
    if (reply.status < 200 || reply.status >= 300) return [answer.error || `The app refused the job (error ${reply.status}).`, "bad"];
    if (answer.skipped) {
      dismissed.add(key);
      return [`Not sent. It offers no visa sponsorship (“${answer.reason}”), and your profiles skip such jobs.`, "bad"];
    }
    const saved = await chrome.storage.local.get(["sent", "optimized"]);
    const add = (list) => [...(Array.isArray(list) ? list : []).filter((k) => k !== key), key].slice(-SENT_KEPT);
    await chrome.storage.local.set({ sent: add(saved.sent), ...(answer.queued ? { optimized: add(saved.optimized) } : {}) });
    if (optimize) {
      const fit = Math.round((answer.fit || 0) * 100);
      if (answer.queued === true) return [`Saved for “${answer.profile_name || answer.profile}” (fit ${fit}%). A resume is being made; it will be in the app under Applications, with the apply link.`, "good"];
      if (answer.queued === "active") return ["This job is already in Applications in the app.", "good"];
      if (answer.queued === "applied") return ["You already applied to this job (Applications, History).", "good"];
      return ["Saved, but none of your profiles fits it, so no resume was made.", ""];
    }
    if (answer.already) return ["You already sent this job. It is in Email JDs.", "good"];
    if (!answer.profile) return ["Saved, but none of your profiles fits it. In Email JDs you can give it to a profile yourself.", ""];
    return [`Saved for your profile “${answer.profile_name || answer.profile}” (fit ${Math.round((answer.fit || 0) * 100)}%).`, "good"];
  }

  async function look() {
    if (document.hidden || busy) return;
    let job;
    let saved;
    try {
      job = globalThis.rbExtract(true);
      saved = await chrome.storage.local.get(["token", "user", "sent", "offer"]);
    } catch {
      clearInterval(timer);   // the extension was reloaded or removed: this copy can do nothing more
      return hide();
    }
    if (job && told === `${job.url}|${job.title}`) return;
    if (!job || !job.title || job.text.length < MIN_TEXT || !saved.token || saved.offer === false) return hide();
    // the same key as popup.js -> jobKey: a job sent from either is "sent" in both
    const key = [saved.user || "", job.url, job.title.toLowerCase(), job.company.toLowerCase()].join("|");
    if (key === showing) return;
    if (dismissed.has(key) || (Array.isArray(saved.sent) && saved.sent.includes(key))) return hide();
    show(job, key);
  }

  timer = setInterval(look, EVERY_MS);
  look();
})();
