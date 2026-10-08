// Runs inside the page the user has open (popup.js injects it on a click, so the extension reads a
// page only when asked). Its last expression is what popup.js receives: everything on the page as
// plain data. Nothing here changes the page or calls a server.
//
// Result: {url, title, language, captured_at, selection, job, meta, structured_data, headings,
//          text: {job, main, full}, links, images, tables, counts}
//   job   what the page's own job data (schema.org JobPosting) says: title, company, location, ...
//   text  job = that posting's description, main = the page's main part, full = the whole page
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

  const job = posting ? {
    title: tidy(posting.title || posting.name),
    company: tidy(one(posting.hiringOrganization)?.name ?? (typeof posting.hiringOrganization === "string" ? posting.hiringOrganization : "")),
    location: place(posting.jobLocation) || (posting.jobLocationType === "TELECOMMUTE" ? "Remote" : ""),
    employment_type: [].concat(posting.employmentType || []).join(", "),
    date_posted: tidy(posting.datePosted),
    valid_through: tidy(posting.validThrough),
    salary: pay(posting.baseSalary),
  } : null;

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
  let main = "";
  for (const node of document.querySelectorAll('main, article, [role="main"]')) {
    const text = tidy(node.innerText);
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
    url: location.href,
    title: tidy(document.title),
    language: document.documentElement.lang || "",
    captured_at: new Date().toISOString(),
    selection: tidy(window.getSelection()?.toString()),
    job,
    meta,
    structured_data: structured,
    headings,
    text: { job: posting ? htmlToText(posting.description) : "", main, full },
    links,
    images,
    tables,
    counts: { words: full ? full.split(/\s+/).length : 0, links: links.length, images: images.length, tables: tables.length },
  };
})();
