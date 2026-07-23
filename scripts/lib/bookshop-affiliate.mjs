/** Bookshop.org affiliate link helper — https://bookshop.org/a/{affiliateId}/{isbn13} */

export const DEFAULT_BOOKSHOP_AFFILIATE_ID = "126485";

export function bookshopAffiliateIdFromEnv(env = process.env) {
  const id = String(env?.BOOKSHOP_AFFILIATE_ID || DEFAULT_BOOKSHOP_AFFILIATE_ID).trim();
  return /^\d+$/.test(id) ? id : DEFAULT_BOOKSHOP_AFFILIATE_ID;
}

export function isbnFromBookshopUrl(url) {
  const u = String(url || "");
  const fromQuery = /[?&]ean=(\d{9,13})\b/i.exec(u)?.[1];
  if (fromQuery) return fromQuery;

  const fromAffiliatePath = /bookshop\.org\/a\/\d+\/(\d{9,13})\b/i.exec(u)?.[1];
  if (fromAffiliatePath) return fromAffiliatePath;

  const fromProductPath = /bookshop\.org\/p\/books\/[^/?#]+\/(\d{13})\b/i.exec(u)?.[1];
  return fromProductPath || null;
}

export function bookshopAffiliateUrl(url, affiliateId = bookshopAffiliateIdFromEnv()) {
  const u = String(url || "").trim();
  if (!u || !/bookshop\.org/i.test(u)) return u;

  const isbn = isbnFromBookshopUrl(u);
  if (!isbn) return u;

  return `https://bookshop.org/a/${affiliateId}/${isbn}`;
}
