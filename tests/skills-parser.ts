import { strict as assert } from "node:assert";
import { parseSkill } from "../lib/skills";
const original =
  "---\nname: example-skill\ndescription: >\n  第一行介绍\n  第二行介绍\n---\n\n# 完整正文\n\n保留空行与 **规则**。\n";
const parsed = parseSkill(original);
assert.equal(parsed.source, original);
assert(parsed.body.includes("**规则**"));
assert(parsed.description.includes("第二行介绍"));
for (const name of [
  "../escape",
  "a/b",
  "a\\b",
  "..",
  "%2fsecret",
  "a--b",
  "/root",
  "C:foo",
]) {
  assert.throws(() =>
    parseSkill(
      `---\nname: '${name.replaceAll("'", "''")}'\ndescription: test\n---\n规则`,
    ),
  );
}
assert.throws(() => parseSkill("---\nname: good\n---\n规则"));
assert.throws(() =>
  parseSkill("---\nname: good\ndescription: [bad]\n---\n规则"),
);
assert.throws(() =>
  parseSkill("---\nname: good\nname: dup\ndescription: test\n---\n规则"),
);
assert.throws(() =>
  parseSkill("---\nname: good\ndescription: &a test\nextra: *a\n---\n规则"),
);
console.log(
  "PASS YAML multiline and full body preservation; traversal, malformed metadata, aliases and duplicate fields rejected",
);
