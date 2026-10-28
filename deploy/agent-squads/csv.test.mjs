import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv } from "./csv.mjs";

test("parses quoted fields with commas, quotes and newlines", () => {
  const rows = parseCsv(
    'Id,Title,Body\r\nX-01,"Accept ADRs, decide","Line one\n- [ ] say ""yes"""\nX-02,Spike,\n',
  );
  assert.deepEqual(rows, [
    {
      Id: "X-01",
      Title: "Accept ADRs, decide",
      Body: 'Line one\n- [ ] say "yes"',
    },
    { Id: "X-02", Title: "Spike", Body: "" },
  ]);
});

test("skips blank lines", () => {
  assert.deepEqual(parseCsv("A,B\n\n1,2\n\n"), [{ A: "1", B: "2" }]);
});
