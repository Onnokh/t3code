import { describe, expect, it } from "vite-plus/test";

import { isLegalDocumentUrl } from "./legal-document-url";

describe("isLegalDocumentUrl", () => {
  it.each([
    "https://devski.onkie.dev/legal",
    "https://devski.onkie.dev/legal/",
    "https://devski.onkie.dev/privacy-policy?source=app",
    "https://devski.onkie.dev/terms-of-service#updates",
    "https://devski.onkie.dev/security-policy",
  ])("allows a configured legal document: %s", (url) => {
    expect(isLegalDocumentUrl(url)).toBe(true);
  });

  it.each([
    "https://t3.codes/download",
    "https://t3.codes/legal",
    "https://example.com/legal",
    "javascript:alert(1)",
    "not-a-url",
  ])("rejects a URL outside the legal-document allowlist: %s", (url) => {
    expect(isLegalDocumentUrl(url)).toBe(false);
  });
});
