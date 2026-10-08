// Runs inside the page the user has open (popup.js injects it on a click, so the extension reads a
// page only when asked). Its last expression is what popup.js receives: everything on the page as
// plain data. Nothing here changes the page or calls a server.
//
// Result: {url, page_url, title, language, captured_at, selection, job, meta, structured_data,
//          apply, headings, text: {panel, job, main, full}, links, images, tables, counts}
//   job   the job's title, company, location, ...: from the job panel on the page (SITES) and the
//         page's own job data (schema.org JobPosting)
//   text  panel = the one job that is open on the page (job boards show a list of postings next
//         to it; the list is left out), job = the description in the page's job data,
//         main = the page's main part, full = the whole page
//   apply {url, label}: where the page's Apply button goes (null when it has none, or when the
//         button opens a form on the page instead of a link)
//   url   the address of that one job when the site has one (SITES), else the page's address
(() => {
  const LIMITS = { links: 2000, images: 1000, tables: 100, rows: 500, text: 400000 };
  const tidy = (value) => String(value ?? "").replace(/ /g, " ").replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const absolute = (href) => { try { return new URL(href, location.href).href; } catch { return ""; } };

  // HTML inside the page's job data -> text with its line breaks. A page may forbid parsing HTML
  // from a script; then the tags are simply removed.
  function htmlToText(html) {
    const source = String(html ?? "");
    if (!/[<&]/.test(source)) return tidy(source);
    const broken = source.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "$&\n").replace(/<li\b[^>]*>/gi, "- ");
    try {
      return tidy(new DOMParser().parseFromString(broken, "text/html").body.textContent);
    } catch {
      return tidy(broken.replace(/<[^>]+>/g, " "));
    }
  }

  // The text a person sees in an element. A part that is not drawn (a panel folded away in a
  // narrow window) has no innerText of its own kind: its styles and scripts are taken out instead.
  function shown(node) {
    if (!node) return "";
    if (node.getClientRects().length) return tidy(node.innerText);
    const copy = node.cloneNode(true);
    copy.querySelectorAll("style, script, noscript, template").forEach((n) => n.remove());
    return tidy(copy.textContent);
  }
  const first = (selectors) => {
    for (const selector of selectors || []) {
      const node = document.querySelector(selector);
      if (node && shown(node)) return node;
    }
    return null;
  };
  const param = (...names) => names.map((n) => new URLSearchParams(location.search).get(n)).find(Boolean);

  // ---- job boards that show a list of postings beside the one that is open: where that one
  // job's text, title, company and location are, and its own address. Each list is tried in
  // order (a site's newer page first). A site that is not here is read by GENERIC below.
  const SITES = [
    { host: /(^|\.)indeed\.[a-z.]+$/,
      panel: ['[data-testid="viewjob-job-content"]', "#jobDescriptionText"],
      title: ['[data-testid="vj-job-title"]', '[data-testid="jobsearch-JobInfoHeader-title"]', ".jobsearch-JobInfoHeader-title"],
      company: ['[data-testid="vj-company-name"]', '[data-testid="inlineHeader-companyName"]'],
      location: ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]'],
      around: ['[data-testid="company-info-metadata"]'],
      apply: ['[data-testid="viewjob-apply"]', '[data-testid="viewjob-indeed-apply"]', "#applyButtonLinkContainer a"],
      leave: '[data-testid^="job-card-"]',
      url: () => { const id = param("vjk", "jk"); return id && `${location.origin}/viewjob?jk=${encodeURIComponent(id)}`; } },
    { host: /(^|\.)linkedin\.com$/,
      panel: ["#job-details", ".jobs-description__content", ".jobs-description-content__text", ".show-more-less-html__markup"],
      title: [".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title", ".top-card-layout__title"],
      company: [".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name", ".topcard__org-name-link"],
      location: [".topcard__flavor--bullet"],
      apply: ["a.jobs-apply-button", "a.apply-button", ".top-card-layout__cta-container a"],
      url: () => { const id = param("currentJobId"); return id && `${location.origin}/jobs/view/${encodeURIComponent(id)}/`; } },
    { host: /(^|\.)dice\.com$/,
      panel: ['[data-testid="jobDescriptionHtml"]', "#jobDescription"],
      apply: ['a[data-cy="apply-button"]', "apply-button-wc a"],
      title: ['[data-cy="jobTitle"]'], company: ['[data-cy="companyNameLink"]'], location: ['[data-cy="location"]'] },
    { host: /(^|\.)glassdoor\.[a-z.]+$/,
      panel: ['[class*="JobDetails_jobDescription"]', '[data-test="jobDescriptionContent"]'],
      title: ['[data-test="job-title"]'], company: ['[data-test="employer-name"]'], location: ['[data-test="location"]'] },
    { host: /(^|\.)ziprecruiter\.com$/,
      panel: ['[data-testid="job-details-scroll-container"]', ".job_description"] },
  ];
  // any other site: an element named after a job description, the one with the most text
  const GENERIC = ["jobdescription", "job-description", "job_description", "jobs-description", "job-details", "jobdetails"]
    .flatMap((word) => [`[id*="${word}" i]`, `[class*="${word}" i]`, `[data-testid*="${word}" i]`]).join(", ");

  const site = SITES.find((entry) => entry.host.test(location.hostname));
  let panel = first(site?.panel);
  const known = Boolean(panel);
  if (!panel) {
    for (const node of document.querySelectorAll(GENERIC)) {
      if (node.getClientRects().length && shown(node).length > Math.max(199, shown(panel).length)) panel = node;
    }
  }
  const onPage = { title: shown(first(site?.title)), company: shown(first(site?.company)), location: shown(first(site?.location)) };
  if (known && site.around && !(onPage.company && onPage.location)) {
    // company and location are lines of one block, with a rating between them on some postings:
    // of the lines that are words, the first is the company and the next one the location
    const lines = shown(first(site.around)).split("\n").map((line) => line.trim()).filter((line) => /[A-Za-z]{2}/.test(line));
    onPage.company ||= lines[0] || "";
    onPage.location ||= lines.find((line) => line !== onPage.company) || "";
  }
  // The Apply button's address: the site's own button, else the first link on the page whose
  // words begin with "Apply" (on a page that is not a known list of postings, that is this job's).
  function applyLink() {
    // a button that leads to a sign-in page (the user is logged out of the site) is not an apply link
    const web = (node) => node?.tagName === "A" && /^https?:/.test(absolute(node.getAttribute("href")))
      && !/^\/(auth|login|signin|sign-in|account\/login)\b/i.test(new URL(absolute(node.getAttribute("href"))).pathname);
    let button = (site?.apply || []).map((selector) => document.querySelector(selector)).find(web);
    if (!button && !known) {
      button = [...document.querySelectorAll("a[href]")].find((node) => web(node) && node.getClientRects().length
        && /^(easy |easily |quick )?apply\b/i.test(tidy(node.innerText || node.getAttribute("aria-label"))));
    }
    return button ? { url: absolute(button.getAttribute("href")), label: tidy(button.innerText || button.getAttribute("aria-label")).slice(0, 80) || "Apply" } : null;
  }

  // The open job's text. A site may put other postings inside the same panel ("more jobs like
  // this"): the parts of the panel that hold what `leave` names are left out.
  function panelText() {
    if (!known || !site.leave || !panel.querySelector(site.leave)) return shown(panel);
    return tidy([...panel.children].filter((part) => !part.matches(site.leave) && !part.querySelector(site.leave))
      .map(shown).filter(Boolean).join("\n\n"));
  }

  // ---- the page's structured data (JSON-LD): job sites publish the posting there for search engines
  const structured = [];
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(node.textContent);
      for (const item of Array.isArray(data) ? data : [data]) {
        if (item && typeof item === "object") structured.push(...(Array.isArray(item["@graph"]) ? item["@graph"] : [item]));
      }
    } catch { /* a page with broken JSON-LD: the rest of the page is still read */ }
  }
  const isJob = (item) => [].concat(item?.["@type"] || []).includes("JobPosting");
  const posting = structured.find(isJob);

  function place(value) {
    const address = one(value)?.address ?? one(value);
    if (typeof address === "string") return tidy(address);
    if (!address || typeof address !== "object") return "";
    const country = typeof address.addressCountry === "object" ? address.addressCountry?.name : address.addressCountry;
    return [address.addressLocality, address.addressRegion, country].filter((v) => typeof v === "string" && v).join(", ");
  }

  function pay(value) {
    const salary = one(value);
    if (!salary || typeof salary !== "object") return typeof salary === "string" ? salary : "";
    const amount = salary.value && typeof salary.value === "object" ? salary.value : salary;
    const range = amount.minValue && amount.maxValue ? `${amount.minValue} - ${amount.maxValue}` : amount.value || amount.minValue || "";
    return [range, salary.currency || amount.currency, amount.unitText && `per ${String(amount.unitText).toLowerCase()}`]
      .filter(Boolean).join(" ");
  }

  const listed = posting ? {
    title: tidy(posting.title || posting.name),
    company: tidy(one(posting.hiringOrganization)?.name ?? (typeof posting.hiringOrganization === "string" ? posting.hiringOrganization : "")),
    location: place(posting.jobLocation) || (posting.jobLocationType === "TELECOMMUTE" ? "Remote" : ""),
    employment_type: [].concat(posting.employmentType || []).join(", "),
    date_posted: tidy(posting.datePosted),
    valid_through: tidy(posting.validThrough),
    salary: pay(posting.baseSalary),
  } : null;
  // the open panel is the job the user is looking at: what it says wins over the page's data
  const found = Object.fromEntries(Object.entries(onPage).filter(([, value]) => value));
  const job = listed || Object.keys(found).length ? { ...listed, ...found } : null;

  // ---- meta tags (description, Open Graph, Twitter cards)
  const meta = {};
  for (const node of document.querySelectorAll("meta[name], meta[property]")) {
    const key = node.getAttribute("name") || node.getAttribute("property");
    const content = node.getAttribute("content");
    if (key && content && !(key in meta)) meta[key] = content;
  }
  const canonical = document.querySelector('link[rel="canonical"]')?.href;
  if (canonical) meta.canonical = canonical;

  // ---- text: the main part is the largest of the elements a page marks as its content
  const full = tidy(document.body?.innerText).slice(0, LIMITS.text);
  const described = posting ? htmlToText(posting.description) : "";
  // a panel found only by its name is a guess: the page's own job data, when it has it, is surer
  const open = known || described.length < 200 ? panelText().slice(0, LIMITS.text) : "";
  let main = "";
  for (const node of document.querySelectorAll('main, article, [role="main"]')) {
    const text = shown(node);
    if (text.length > main.length) main = text;
  }
  main = (main.length >= 200 ? main : full).slice(0, LIMITS.text);

  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
    .map((node) => ({ level: Number(node.tagName[1]), text: tidy(node.innerText) })).filter((h) => h.text);

  const seen = new Set();
  const links = [];
  for (const node of document.querySelectorAll("a[href]")) {
    const href = absolute(node.getAttribute("href"));
    if (!/^(https?|mailto|tel):/.test(href) || seen.has(href)) continue;
    seen.add(href);
    links.push({ text: tidy(node.innerText || node.getAttribute("aria-label") || node.title).slice(0, 300), href });
    if (links.length >= LIMITS.links) break;
  }

  const images = [];
  for (const node of document.images) {
    const src = absolute(node.currentSrc || node.src);
    if (!src || src.startsWith("data:") || seen.has(src)) continue;   // an embedded image would only bloat the file
    seen.add(src);
    images.push({ src, alt: tidy(node.alt), width: node.naturalWidth, height: node.naturalHeight });
    if (images.length >= LIMITS.images) break;
  }

  const tables = [...document.querySelectorAll("table")].slice(0, LIMITS.tables).map((table) => ({
    caption: tidy(table.caption?.innerText),
    rows: [...table.rows].slice(0, LIMITS.rows).map((row) => [...row.cells].map((cell) => tidy(cell.innerText))),
  })).filter((table) => table.rows.length);

  return {
    url: (open && site?.url?.()) || location.href,
    page_url: location.href,
    title: tidy(document.title),
    language: document.documentElement.lang || "",
    captured_at: new Date().toISOString(),
    selection: tidy(window.getSelection()?.toString()),
    job,
    apply: applyLink(),
    meta,
    structured_data: structured,
    headings,
    text: { panel: open, job: described, main, full },
    links,
    images,
    tables,
    counts: { words: full ? full.split(/\s+/).length : 0, links: links.length, images: images.length, tables: tables.length },
  };
})();
