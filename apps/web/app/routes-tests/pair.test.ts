import { expect, it } from "vitest";
import { pairingCodeFromHash } from "../routes/pair";

it("reads an eight-digit pairing code from a QR URL fragment", () => {
  expect(pairingCodeFromHash("#code=12345678")).toBe("12345678");
  expect(pairingCodeFromHash("#code=12ab34567890")).toBe("12345678");
});
