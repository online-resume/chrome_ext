// Does a job posting say whether visa sponsorship is offered? Plain text rules, no model and no
// call to the app: the popup shows the answer as soon as it opens.
//
// RULES and OFFERS are the app's own (prod/utils/sponsorship.py -> no_sponsorship), kept the same
// here so that "Not offered" in the popup is exactly what the app skips for a profile that skips
// such jobs; prod/tests/test_profile_cards.py runs both on the same postings. A change to one
// belongs in the other.
//
// A plain script, not a module: the popup loads it with a script tag and the job sites get it as a
// content script (which cannot be a module). It defines rbSponsorship.
//
// rbSponsorship(text) -> {status: "no" | "yes" | "unknown", words}
//   no       the posting says none is offered, rules out sponsored visas, or takes citizens /
//            green card holders only; `words` are the posting's own
//   yes      it says sponsorship is offered (or that visa holders are welcome)
//   unknown  it does not mention it

(() => {
const VISA = "(?:h-?1-?b|h1|opt|cpt|stem[- ]opt|tn|e-?3|visa)";
const CITIZEN = "(?:u\\.?s\\.?a?\\.?|united states|american)\\s+citizens?(?:hip)?";
const RULES = [
  "\\bno\\s+(?:\\w+\\s+){0,2}sponsorships?\\b",
  "\\bnot?\\s+(?:able|offering|providing|eligible)\\s+(?:\\w+\\s+){0,3}sponsor",
  "\\bsponsorships?\\s+(?:\\w+\\s+){0,4}(?:is|are|will)\\s*(?:not|n[o']t)\\s+(?:\\w+\\s+){0,2}(?:available|offered|provided|possible|supported|considered)",
  "\\bsponsorships?\\s*(?:[:\\-–]\\s*)?(?:not\\s+(?:available|offered|provided)|unavailable|no\\b)",
  "\\b(?:unable|not\\s+able|cannot|can\\s*not|can'?t|will\\s+not|won'?t|do(?:es)?\\s+not|do(?:es)?n'?t|not\\s+going)\\s+(?:\\w+\\s+){0,3}(?:to\\s+)?sponsor",
  "\\bwithout\\s+(?:\\w+\\s+){0,5}sponsorship",
  "\\bnot\\s+(?:\\w+\\s+){0,2}require\\s+(?:\\w+\\s+){0,4}sponsorship",
  `\\bno\\s+${VISA}\\b`,
  `\\b${VISA}\\s*(?:holders?|candidates?|visas?|transfers?)?\\s*(?:is|are|will)?\\s*not\\s+(?:\\w+\\s+){0,2}(?:accepted|considered|eligible|sponsored|supported|workable)`,
  `\\b(?:only\\s+${CITIZEN}|${CITIZEN}(?:\\s+(?:and|or|/)\\s+(?:green\\s*card|gc|permanent\\s+residents?)(?:\\s+holders?)?)?\\s+only)\\b`,
  "\\b(?:usc|gc)\\s*(?:/|and|or|&)\\s*(?:usc|gc)\\s+only\\b",
  "\\bonly\\s+(?:usc|gc)\\b|\\b(?:usc|gc(?:\\s+holders?)?)\\s+only\\b",
  `\\bmust\\s+be\\s+(?:a\\s+)?${CITIZEN}`,
].map((pattern) => new RegExp(pattern, "i"));
const OFFERS = new RegExp("\\b(?:visa\\s+)?sponsorships?\\s+(?:is\\s+|are\\s+)?(?:available|offered|provided|possible)\\b"
  + "|\\bwill(?:ing)?\\s+(?:to\\s+)?sponsor\\b|\\bwe\\s+sponsor\\b|\\bsponsorship\\s*[:\\-–]\\s*yes\\b", "i");
// Only for the popup's "Offered": a posting that welcomes visa holders offers it in other words.
const WELCOMES = new RegExp(`\\b${VISA}s?\\s+(?:holders?\\s+|candidates?\\s+|transfers?\\s+)?(?:are\\s+|is\\s+)?(?:welcome|accepted|ok(?:ay)?)\\b`
  + "|\\bopen\\s+to\\s+all\\s+visas?\\b", "i");
const DENIES = /\bno\b|\bnot\b|n't|\bunable\b/i;
const words = (found) => found[0].split(/\s+/).filter(Boolean).join(" ").slice(0, 80);

globalThis.rbSponsorship = (text) => {
  // sentences: a line break, or a full stop after a word of three letters or more ("U.S. citizen" stays whole)
  const sentences = String(text ?? "").split(/(?<=[A-Za-z0-9)]{3}[.!?])\s+|[\r\n]+/).filter((s) => s && s.trim());
  let offered = null;
  for (const sentence of sentences) {
    if (OFFERS.test(sentence) && !DENIES.test(sentence)) {   // a sentence that offers it is never a "no"
      offered ??= words(OFFERS.exec(sentence));
      continue;
    }
    for (const rule of RULES) {
      const found = rule.exec(sentence);
      if (found) return { status: "no", words: words(found) };
    }
    if (!DENIES.test(sentence)) offered ??= WELCOMES.test(sentence) ? words(WELCOMES.exec(sentence)) : null;
  }
  return offered ? { status: "yes", words: offered } : { status: "unknown", words: "" };
};
})();
