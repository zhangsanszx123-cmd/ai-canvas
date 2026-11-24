import { strict as assert } from "node:assert";
import sharp from "sharp";
import { imageInfo } from "../lib/storage";
async function main() {
  const rotated = await sharp({
    create: { width: 300, height: 100, channels: 3, background: "red" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const bounds = await imageInfo(rotated);
  assert.equal(bounds.width, 100);
  assert.equal(bounds.height, 300);
  const upright = await sharp({
    create: { width: 100, height: 300, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const png = await imageInfo(upright);
  assert.equal(png.width, 100);
  assert.equal(png.height, 300);
  console.log(
    "PASS portrait PNG and EXIF-rotated JPEG have actual display bounds",
  );
}
void main();
