// Runs inside a page and defines rbExtract(), which reads the page as plain data. Nothing here
// changes the page or calls a server. Two callers:
//   popup.js  injects this file when the user clicks the icon, then calls rbExtract(): everything
//             on the page (the Result below)
//   watch.js  on the job sites in manifest.json -> content_scripts, calls rbExtract(true) every
//             few seconds: only the job that is open in a known site's panel, as
//             {url, title, company, location, text, apply} - or null when no job is open
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
globalThis.rbExtract = (light = false) => {
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
  // the first of these that is on the page with words in it; each is a selector or a function that finds the element
  const first = (selectors) => {
    for (const selector of selectors || []) {
      const node = typeof selector === "function" ? selector() : document.querySelector(selector);
      if (node && shown(node)) return node;
    }
    return null;
  };
  // the heading inside `root` whose words match (a part of a page that has no name of its own)
  const titled = (root, words) => [...root.querySelectorAll("h1, h2, h3, h4")].find((h) => words.test(tidy(h.textContent)));
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
    // LinkedIn has two pages. Signed out (checked on the live site, Oct 2026): .top-card-layout /
    // .show-more-less-html__markup. Signed in (from its known structure; a signed-in page could
    // not be opened to check): .job-details-jobs-unified-top-card / #job-details. Each list has
    // the signed-in names first. Its Apply and Easy Apply are buttons without an address, so a
    // role from LinkedIn usually has no apply link and its own link leads to the job.
    { host: /(^|\.)linkedin\.com$/,
      panel: ["#job-details", ".jobs-description__content", ".jobs-description-content__text", ".jobs-box__html-content",
        ".show-more-less-html__markup", ".description__text",
        // whatever the page's elements are called: the block under the heading "About the job"
        () => {
          let node = titled(document, /^about the job$/i)?.parentElement;
          while (node && node.parentElement && node !== document.body && shown(node).length < 300) node = node.parentElement;
          return node && node !== document.body ? node : null;
        }],
      // the job's facts shown outside its description (level, employment type, workplace, pay)
      more: [".job-details-fit-level-preferences", ".job-details-jobs-unified-top-card__job-insight", ".description__job-criteria-list"],
      title: [".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title", ".top-card-layout__title", ".topcard__title",
        'h1 a[href*="/jobs/view/"]', ".jobs-search__job-details--container h1", "main h1"],
      company: [".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name", ".topcard__org-name-link",
        '.jobs-search__job-details--container a[href*="/company/"]', 'main a[href*="/company/"]'],
      // signed in it is the first part of one line: "Dallas, TX · 1 week ago · 91 applicants"
      location: () => shown(first([".topcard__flavor--bullet"])) || shown(first([".job-details-jobs-unified-top-card__primary-description-container",
        ".job-details-jobs-unified-top-card__tertiary-description-container", ".jobs-unified-top-card__bullet"])).split(/\s*·\s*|\n/)[0],
      apply: ["a.jobs-apply-button", "a.apply-button", ".top-card-layout__cta-container a.apply-button"],
      url: () => {
        // the job's number: in the address (?currentJobId=, /jobs/view/<number> or /jobs/view/<words>-<number>),
        // else on the open job's own title link, else on the card that is marked as open in the list
        const id = param("currentJobId") || /\/jobs\/view\/(?:[^/?]*-)?(\d+)/.exec(location.pathname)?.[1]
          || /-(\d+)(?:[/?]|$)/.exec(document.querySelector("a.topcard__link")?.getAttribute("href") || "")?.[1]
          || /(\d+)$/.exec(document.querySelector(".job-search-card--active, .jobs-search-results-list__list-item--active [data-job-id]")
            ?.getAttribute("data-entity-urn") || "")?.[1];
        return id && `https://www.linkedin.com/jobs/view/${id}/`;
      } },
    // Dice (checked on the live site, Oct 2026): the search page shows the open job in a pane, the
    // job's own page in <main>. Both hold other things too (a match score, a job alert, similar
    // jobs): `keep` and `drop` name what belongs to the job and what does not (see panelText).
    { host: /(^|\.)dice\.com$/,
      panel: ['[data-testid="job-detail-pane"]', 'main:has([data-testid="job-detail-header-card"])',
        '[data-testid="jobDescriptionHtml"]', "#jobDescription"],
      title: ['[data-testid="job-detail-header-card"] h1', '[data-cy="jobTitle"]'],
      company: ['[data-testid="job-detail-header-card"] a[href*="/company-profile/"]', '[data-cy="companyNameLink"]'],
      // one line of the header: "Addison, TX, US • Posted 1 day ago • Updated ..."
      location: () => shown(first(['[data-testid="job-detail-header-card"]'])).split("\n")
        .find((line) => /•\s*Posted/i.test(line))?.split("•")[0].trim() || shown(first(['[data-cy="location"]'])),
      apply: ['[data-testid="apply-button"]', 'a[data-cy="apply-button"]', "apply-button-wc a"],
      keep: (panel) => [panel.querySelector('[data-testid="job-detail-header-card"]'), titled(panel, /^job details$/i)],
      drop: (panel) => [...panel.querySelectorAll('[data-testid="job-card"], [data-testid="job-detail-job-alert"], section[aria-label="Related jobs"]'),
        titled(panel, /job match score/i), titled(panel, /^similar jobs$/i)],
      url: () => {
        const own = document.querySelector('[data-testid="job-detail-open-in-new-tab-btn"]')?.getAttribute("href");
        return own ? absolute(own) : location.pathname.startsWith("/job-detail/") ? location.origin + location.pathname : null;
      } },
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
  if (light && !known) return null;
  if (!panel) {
    for (const node of document.querySelectorAll(GENERIC)) {
      if (node.getClientRects().length && shown(node).length > Math.max(199, shown(panel).length)) panel = node;
    }
  }
  const said = (where) => (typeof where === "function" ? tidy(where()) : shown(first(where)));
  const onPage = { title: said(site?.title), company: said(site?.company), location: said(site?.location) };
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

  // For a panel that mixes the job with other things. Each thing a site names in `drop` is left
  // out together with as much around it as does not hold a part of the job (`keep`): from a
  // "similar job" card up to the whole "Similar Jobs" block, but never the job's own text.
  function outside(root, keep, drop) {
    const wanted = keep.filter(Boolean);
    const gone = new Set();
    for (let node of drop.filter(Boolean)) {
      while (node.parentElement && node.parentElement !== root && !wanted.some((part) => node.parentElement.contains(part))) {
        node = node.parentElement;
      }
      if (!wanted.some((part) => node.contains(part))) gone.add(node);
    }
    return gone;
  }

  // The text of `root` as a person reads it, without the parts in `gone` and without what is not
  // drawn: like innerText, which cannot leave parts out. Every block starts a new line; paragraphs
  // and headings (PARAS, marked with \r while walking) get an empty line around them.
  const BLOCKS = new Set(["DIV", "P", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "SECTION", "ARTICLE",
    "HEADER", "FOOTER", "TABLE", "TR", "DL", "DT", "DD", "BLOCKQUOTE", "PRE", "HR"]);
  const PARAS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "TABLE"]);
  function textWithout(root, gone) {
    const out = [];
    (function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) { out.push(child.nodeValue.replace(/\s+/g, " ")); continue; }
        if (child.nodeType !== Node.ELEMENT_NODE || gone.has(child)) continue;
        if (["STYLE", "SCRIPT", "NOSCRIPT", "TEMPLATE", "SVG", "svg", "BUTTON"].includes(child.tagName)) continue;
        if (root.getClientRects().length && !child.getClientRects().length && child.tagName !== "BR") continue;   // not drawn
        const edge = PARAS.has(child.tagName) ? "\r" : BLOCKS.has(child.tagName) || child.tagName === "BR" ? "\n" : "";
        out.push(edge, child.tagName === "LI" ? "- " : "");
        walk(child);
        out.push(edge);
      }
    })(root);
    // a run of line ends is one line end, or an empty line when a paragraph or heading is among them
    return tidy(out.join("").replace(/[ \t]*[\n\r][ \t\n\r]*/g, (run) => (run.includes("\r") ? "\n\n" : "\n"))
      .replace(/^- *\n+/gm, "- "));
  }

  // The open job's text. A site may put other postings inside the same panel ("more jobs like
  // this"): the parts of the panel that hold what `leave` names are left out.
  function panelText() {
    if (known && site.more) {   // facts a site shows beside the description: put under it
      const extra = site.more.map((selector) => document.querySelector(selector))
        .filter((node) => node && !panel.contains(node) && !node.contains(panel)).map(shown).filter(Boolean);
      return [shown(panel), ...new Set(extra)].join("\n\n");
    }
    if (known && site.drop) return textWithout(panel, outside(panel, site.keep(panel), site.drop(panel)));
    if (!known || !site.leave || !panel.querySelector(site.leave)) return shown(panel);
    return tidy([...panel.children].filter((part) => !part.matches(site.leave) && !part.querySelector(site.leave))
      .map(shown).filter(Boolean).join("\n\n"));
  }

  if (light) {
    return { url: site.url?.() || location.href, ...onPage, text: panelText().slice(0, LIMITS.text), apply: applyLink() };
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
};
