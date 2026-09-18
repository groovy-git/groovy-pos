// Generates PWA icons from public/logo.svg:  npm run icons
// If you have the original logo PNG, save it as public/logo-source.png and it will be used instead.
import sharp from "sharp";
import fs from "fs";

const out = "public/icons";
fs.mkdirSync(out, { recursive: true });
const src = fs.existsSync("public/logo-source.png") ? "public/logo-source.png" : "public/logo.svg";
const gold = { r: 245, g: 191, b: 3, alpha: 1 };
const logo = (size) => sharp(src, { density: 384 }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

// full-bleed gold tile with the logo inside the 80% safe zone (maskable / iOS)
async function tile(size, file) {
  const inner = Math.round(size * 0.86);
  await sharp({ create: { width: size, height: size, channels: 4, background: gold } })
    .composite([{ input: await logo(inner), gravity: "center" }])
    .png()
    .toFile(`${out}/${file}`);
}

await sharp(await logo(192)).toFile(`${out}/icon-192.png`);
await sharp(await logo(512)).toFile(`${out}/icon-512.png`);
await tile(512, "maskable-512.png");
await tile(180, "apple-touch-icon.png");
console.log("Icons written to", out, "from", src);
