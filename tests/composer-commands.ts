import { strict as assert } from "node:assert";
import { composerCommand, consumeCommand } from "../lib/composer-commands";
for (const value of [
  "https://example.com/path",
  "hello@example.com",
  "path/to/file",
  "价格 1/2",
])
  assert.equal(composerCommand(value, value.length), null);
const text = "请做海报 /cover 后面的文字保留";
const command = composerCommand(text, text.indexOf(" 后面"));
assert(command);
assert.equal(command.kind, "skill");
assert.equal(command.query, "cover");
assert.equal(consumeCommand(text, command), "请做海报  后面的文字保留");
const chinese = "参考 @产品图";
assert.equal(composerCommand(chinese, chinese.length)?.query, "产品图");
assert.equal(composerCommand("\n/", 2)?.kind, "skill");
assert.equal(composerCommand("🙂 @图", "🙂 @图".length)?.kind, "asset");
console.log(
  "PASS shortcuts preserve cursor text, Chinese/emoji and ignore paths, URLs, fractions and email addresses.",
);
