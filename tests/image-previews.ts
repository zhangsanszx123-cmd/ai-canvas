import { strict as assert } from "node:assert";
import sharp from "sharp";
import { createImagePreview } from "../lib/storage";
import { imageDisplayUrl } from "../lib/image-display";

async function main() {
  const original = await sharp({
    create: {
      width: 2048,
      height: 1536,
      channels: 4,
      background: { r: 20, g: 90, b: 170, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const copy = Buffer.from(original);
  const preview = await createImagePreview(original);
  const meta = await sharp(preview).metadata();
  assert.deepEqual(
    [meta.width, meta.height, meta.format, meta.hasAlpha],
    [1024, 768, "webp", true],
  );
  assert(preview.length < original.length);
  assert(original.equals(copy), "original bytes must remain unchanged");
  const small = await sharp({
    create: { width: 320, height: 200, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const smallMeta = await sharp(await createImagePreview(small)).metadata();
  assert.deepEqual([smallMeta.width, smallMeta.height], [320, 200]);
  assert.equal(
    imageDisplayUrl("/api/public/assets/example/content"),
    "/api/public/assets/example/content?preview=1",
  );
  assert.equal(
    imageDisplayUrl("/api/assets/example/content"),
    "/api/assets/example/content?preview=1",
  );
  assert.equal(
    imageDisplayUrl("https://example.com/original.png"),
    "https://example.com/original.png",
  );
  console.log(
    "PASS preview dimensions, transparency, original retention, small images and display URL handling",
  );
}
void main();
