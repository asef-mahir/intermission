// Pure-Node PNG generator — no external deps
// Draws a sage-green circle with a white leaf inside
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function writePNG(size, outPath) {
  const w = size, h = size;
  const cx = w / 2, cy = h / 2;
  const r = size / 2; // circle radius

  // Helper: is point inside circle?
  function inCircle(x, y) {
    return (x - cx) ** 2 + (y - cy) ** 2 <= (r - 0.5) ** 2;
  }

  // Leaf shape: parametric. A leaf = intersection of two offset circles.
  // Leaf center slightly above mid, pointing top-right.
  const lCx = cx + size * 0.00;
  const lCy = cy + size * 0.04;
  const leafR = size * 0.26;      // radius of each lobe circle
  const offset = size * 0.19;     // how far apart the two lobe centers are

  // Rotate leaf 35deg clockwise so it tilts upper-right
  const angle = -35 * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);

  // Two lobe centers in leaf local space (vertical)
  // lobe1 above, lobe2 below — then rotate
  const l1x = lCx + (-sin * (-offset));
  const l1y = lCy + (cos * (-offset));
  const l2x = lCx + (-sin * (offset));
  const l2y = lCy + (cos * (offset));

  function inLeaf(x, y) {
    const d1 = (x - l1x) ** 2 + (y - l1y) ** 2;
    const d2 = (x - l2x) ** 2 + (y - l2y) ** 2;
    return d1 <= leafR * leafR && d2 <= leafR * leafR;
  }

  // Vein: a thin line from leaf bottom to top along leaf axis
  const veinW = Math.max(1, size * 0.025);

  function onVein(x, y) {
    // Project onto leaf axis
    const dx = x - lCx, dy = y - lCy;
    // axis direction (rotated 90 from offset direction) = (cos, sin) of main angle
    // The leaf axis is along (sin_angle_neg, -cos_angle) => actually along (-sin, cos)
    const proj = dx * (-sin) + dy * (cos); // projection on axis
    const perp = dx * (cos) + dy * (sin);  // perpendicular
    return Math.abs(perp) <= veinW && proj > -leafR * 0.85 && proj < leafR * 0.85;
  }

  // Stem: a short vertical stroke below the leaf
  const stemTopY  = lCy + offset + leafR * 0.3;
  const stemBotY  = cy + r * 0.68;
  const stemX     = lCx;
  const stemW     = Math.max(1, size * 0.03);

  function onStem(x, y) {
    return Math.abs(x - stemX) <= stemW && y >= stemTopY && y <= stemBotY;
  }

  // Small accent circle (sparkle), upper-right quadrant
  const spX = cx + r * 0.52, spY = cy - r * 0.52;
  const spR = r * 0.08;

  function inSparkle(x, y) {
    return (x - spX) ** 2 + (y - spY) ** 2 <= spR * spR;
  }

  // Colors
  const bgR = 70,  bgG = 118, bgB = 90;   // #46765a — sage green
  const lfR = 232, lfG = 245, lfB = 235;  // #e8f5eb — leaf fill
  const vnR = 70,  vnG = 118, vnB = 90;   // vein = slightly darker, actually use bg tinted
  const stR = 200, stG = 230, stB = 210;  // #c8e6d2 — stem
  const spRc = 255, spGc = 255, spBc = 255; // white sparkle

  // Build RGBA rows
  const rawRows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4); // filter byte + RGBA
    row[0] = 0; // None filter
    for (let x = 0; x < w; x++) {
      const i = 1 + x * 4;
      if (!inCircle(x, y)) {
        // transparent outside circle
        row[i] = 0; row[i+1] = 0; row[i+2] = 0; row[i+3] = 0;
      } else if (inSparkle(x, y)) {
        row[i] = spRc; row[i+1] = spGc; row[i+2] = spBc; row[i+3] = 180;
      } else if (inLeaf(x, y)) {
        if (onVein(x, y)) {
          // vein: slightly greener than bg
          row[i] = 55; row[i+1] = 100; row[i+2] = 72; row[i+3] = 220;
        } else {
          row[i] = lfR; row[i+1] = lfG; row[i+2] = lfB; row[i+3] = 255;
        }
      } else if (onStem(x, y)) {
        row[i] = stR; row[i+1] = stG; row[i+2] = stB; row[i+3] = 200;
      } else {
        row[i] = bgR; row[i+1] = bgG; row[i+2] = bgB; row[i+3] = 255;
      }
    }
    rawRows.push(row);
  }

  const raw = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const tb = Buffer.from(type, "ascii");
    const crcBuf = Buffer.concat([tb, data]);
    const crc = crc32(crcBuf);
    const crcOut = Buffer.alloc(4); crcOut.writeUInt32BE(crc >>> 0);
    return Buffer.concat([len, tb, data, crcOut]);
  }

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    if (!crc32.table) {
      crc32.table = [];
      for (let n = 0; n < 256; n++) {
        let v = n;
        for (let k = 0; k < 8; k++) v = (v & 1) ? 0xEDB88320 ^ (v >>> 1) : v >>> 1;
        crc32.table[n] = v;
      }
    }
    for (let i = 0; i < buf.length; i++) c = crc32.table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const idat = compressed;
  const iend = Buffer.alloc(0);

  const png = Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", iend),
  ]);

  fs.writeFileSync(outPath, png);
  console.log("Written:", outPath, png.length, "bytes");
}

writePNG(16, path.join(__dirname, "icon16.png"));
writePNG(32, path.join(__dirname, "icon32.png"));
writePNG(48, path.join(__dirname, "icon48.png"));
writePNG(128, path.join(__dirname, "icon128.png"));
console.log("All icons generated!");
