/* 极简 EXIF 读取（JPEG APP1），用于自动提取拍摄参数。无任何依赖。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.exif = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function parseExif(buf) {
    // buf: Uint8Array（原始文件字节）。只处理 JPEG，返回 { make, model, shutter, aperture, iso, focal, lens } 或 null
    if (!buf || buf.length < 12) return null;
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;   // 非 JPEG
    let pos = 2;
    while (pos + 4 <= buf.length) {
      if (buf[pos] !== 0xFF) { pos++; continue; }
      const marker = buf[pos + 1];
      if (marker === 0xD8 || marker === 0x01) { pos += 2; continue; }
      if (marker >= 0xD0 && marker <= 0xD7) { pos += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break;        // 到图像数据，元数据结束
      const segLen = (buf[pos + 2] << 8) | buf[pos + 3];
      if (segLen < 2) break;
      if (marker === 0xE1) {
        const payload = buf.subarray(pos + 4, pos + 2 + segLen);
        // APP1 段内：Exif\0\0 + TIFF 头
        if (payload.length >= 12 &&
            payload[0] === 0x45 && payload[1] === 0x78 &&
            payload[2] === 0x69 && payload[3] === 0x66 &&
            payload[4] === 0x00 && payload[5] === 0x00) {
          const ex = parseTiff(payload.subarray(6));
          if (ex) return ex;
        }
      }
      pos += 2 + segLen;
    }
    return null;
  }

  function parseTiff(t) {
    let le;
    if (t[0] === 0x49 && t[1] === 0x49) le = true;
    else if (t[0] === 0x4D && t[1] === 0x4D) le = false;
    else return null;
    if (t.length < 10) return null;

    const u16 = (o) => le ? (t[o] | (t[o + 1] << 8)) : ((t[o] << 8) | t[o + 1]);
    const u32 = (o) => le
      ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24))
      : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]);
    if (u16(2) !== 42) return null;

    const readIfd = (off, into) => {
      if (off <= 0 || off + 2 > t.length) return;
      const count = u16(off);
      let o = off + 2;
      for (let i = 0; i < count && o + 12 <= t.length; i++, o += 12) {
        const tag = u16(o), type = u16(o + 2), num = u32(o + 4), vo = o + 8;
        let v;
        switch (type) {
          case 1:  v = t[vo]; break;                                     // BYTE
          case 3:  v = u16(vo); break;                                   // SHORT
          case 4:  v = u32(vo); break;                                   // LONG
          case 9:  v = u32(vo); break;                                   // SLONG
          case 2: {                                                      // ASCII
            const so = num > 4 ? u32(vo) : vo;
            let s = '';
            const end = Math.min(so + num, t.length);
            for (let k = so; k < end; k++) { const c = t[k]; if (!c) break; s += String.fromCharCode(c); }
            v = s;
            break;
          }
          case 5: {                                                      // RATIONAL（value 字段存偏移，指向 8 字节的 分子/分母）
            const off = u32(vo);
            const num = u32(off);
            const den = u32(off + 4);
            v = den ? num / den : 0;
            break;
          }
          case 10: {                                                     // SRATIONAL
            const off = u32(vo);
            const num = (u32(off) | 0);
            const den = (u32(off + 4) | 0);
            v = den ? num / den : 0;
            break;
          }
          default: continue;
        }
        switch (tag) {
          case 0x010F: into.make = String(v); break;       // 相机厂商
          case 0x0110: into.model = String(v); break;      // 相机型号
          case 0x829A: into.shutter = v; break;            // 曝光时间（秒）
          case 0x829D: into.aperture = v; break;           // 光圈 F 值
          case 0x8827: into.iso = Number(v); break;        // ISO
          case 0x920A: into.focal = v; break;              // 焦距（mm）
          case 0xA434: into.lens = String(v); break;       // 镜头名
          case 0x8769: into._exif = u32(vo); break;        // Exif IFD 指针
        }
      }
    };

    const out = {};
    readIfd(u32(4), out);
    if (out._exif) {
      const sub = {};
      readIfd(out._exif, sub);
      delete out._exif;
      Object.assign(out, sub);
    }
    return out;
  }

  return { parseExif: parseExif };
});
