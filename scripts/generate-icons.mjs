// Generate Android launcher icons from the Bhoomi Dwellers logo.
// Source: public/assets/logobrowser_trans.png (1536x1024, transparent bg)
// Run: node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const SRC = join(import.meta.dirname, "../public/assets/logobrowser_trans.png");
const RES = join(import.meta.dirname, "../android/app/src/main/res");

// Android adaptive icon: 108dp per density
const FOREGROUND_SIZES = {
  "mipmap-mdpi": 108,
  "mipmap-hdpi": 162,
  "mipmap-xhdpi": 216,
  "mipmap-xxhdpi": 324,
  "mipmap-xxxhdpi": 432,
};

// Legacy launcher icon: 48dp per density
const LEGACY_SIZES = {
  "mipmap-mdpi": 48,
  "mipmap-hdpi": 72,
  "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144,
  "mipmap-xxxhdpi": 192,
};

async function generate() {
  // Step 1: Read source and make it square with padding
  const src = sharp(SRC);
  const meta = await src.metadata();
  const side = Math.max(meta.width, meta.height);

  // Square canvas, logo centred, transparent background
  const squareBuf = await sharp(SRC)
    .resize({
      width: side,
      height: side,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  // Step 2: Generate foreground icons (logo with padding for safe zone)
  // Adaptive icon safe zone is inner 66% (72/108). Add ~18% padding so the
  // logo sits inside the safe zone.
  for (const [folder, size] of Object.entries(FOREGROUND_SIZES)) {
    const dir = join(RES, folder);
    await mkdir(dir, { recursive: true });

    // Foreground: logo occupies ~70% of the canvas, centred
    const logoSize = Math.round(size * 0.70);
    const logoBuf = await sharp(squareBuf)
      .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const foreground = await sharp({
      create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: logoBuf, gravity: "centre" }])
      .png()
      .toFile(join(dir, "ic_launcher_foreground.png"));

    console.log(`  ${folder}/ic_launcher_foreground.png  ${size}x${size}`);
  }

  // Step 3: Generate legacy launcher icons (with white background, rounded look)
  for (const [folder, size] of Object.entries(LEGACY_SIZES)) {
    const dir = join(RES, folder);
    await mkdir(dir, { recursive: true });

    // Legacy: logo at ~75% with white bg
    const logoSize = Math.round(size * 0.75);
    const logoBuf = await sharp(squareBuf)
      .resize(logoSize, logoSize, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toBuffer();

    // ic_launcher.png — square with white background
    await sharp({
      create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .composite([{ input: logoBuf, gravity: "centre" }])
      .png()
      .toFile(join(dir, "ic_launcher.png"));

    // ic_launcher_round.png — same content (Android clips it into a circle)
    await sharp({
      create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .composite([{ input: logoBuf, gravity: "centre" }])
      .png()
      .toFile(join(dir, "ic_launcher_round.png"));

    console.log(`  ${folder}/ic_launcher.png + ic_launcher_round.png  ${size}x${size}`);
  }

  // Step 4: Write adaptive icon XML (white background layer)
  const bgXml = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <solid android:color="#FFFFFF"/>
</shape>
`;
  const drawableDir = join(RES, "drawable");
  await mkdir(drawableDir, { recursive: true });
  await writeFile(join(drawableDir, "ic_launcher_background.xml"), bgXml);

  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  const anydpiDir = join(RES, "mipmap-anydpi-v26");
  await mkdir(anydpiDir, { recursive: true });
  await writeFile(join(anydpiDir, "ic_launcher.xml"), adaptiveXml);
  await writeFile(join(anydpiDir, "ic_launcher_round.xml"), adaptiveXml);

  console.log("\nDone. All Android launcher icons generated.");
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
