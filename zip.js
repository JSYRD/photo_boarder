/* zip.js —— 零依赖 ZIP 打包/解包（DEFLATE），浏览器与 Node 通用。
 * 压缩：固定哈夫曼 + LZ77；解压：兼容 store / fixed / dynamic 三种块类型。
 * 输出为标准 ZIP，可被 macOS「归档实用工具」、unzip、WinRAR 等直接打开。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.zip = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ================= CRC32 ================= */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(data) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < data.length; i++) c = (CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ================= 位读写（均 LSB-first，与 RFC1951 一致） ================= */
  function BitWriter() { this.bytes = []; this.acc = 0; this.n = 0; }
  BitWriter.prototype.writeBits = function (value, nbits) {
    for (var i = 0; i < nbits; i++) {
      this.acc |= ((value >>> i) & 1) << this.n;
      if (++this.n === 8) { this.bytes.push(this.acc); this.acc = 0; this.n = 0; }
    }
  };
  BitWriter.prototype.finish = function () {
    if (this.n) this.bytes.push(this.acc);
    return new Uint8Array(this.bytes);
  };

  function BitReader(bytes) { this.b = bytes; this.pos = 0; this.bit = 0; }
  BitReader.prototype.read = function (n) {
    var v = 0;
    for (var i = 0; i < n; i++) {
      v |= ((this.b[this.pos] >>> this.bit) & 1) << i;
      if (++this.bit === 8) { this.bit = 0; this.pos++; }
    }
    return v;
  };
  BitReader.prototype.align = function () { if (this.bit) { this.bit = 0; this.pos++; } };

  /* ================= 规范哈夫曼编码（RFC1951 §3.2.2） ================= */
  var MAXBITS = 15;
  function buildCodes(lengths) {
    var blCount = new Array(MAXBITS + 1).fill(0);
    var maxLen = 0, i;
    for (i = 0; i < lengths.length; i++) {
      var l = lengths[i];
      if (l) { blCount[l]++; if (l > maxLen) maxLen = l; }
    }
    var code = 0, nextCode = new Array(MAXBITS + 1).fill(0);
    for (i = 1; i <= MAXBITS; i++) {
      code = (code + blCount[i - 1]) << 1;
      nextCode[i] = code;
    }
    var codes = new Array(lengths.length).fill(0);
    for (i = 0; i < lengths.length; i++) {
      var len = lengths[i];
      if (len) codes[i] = nextCode[len]++;
    }
    return { codes: codes, maxLen: maxLen };
  }
  function reverseBits(code, len) {
    var r = 0;
    for (var i = 0; i < len; i++) { r = (r << 1) | (code & 1); code >>>= 1; }
    return r;
  }

  /* ================= DEFLATE 固定哈夫曼参数 ================= */
  var LITLEN_LENGTHS = new Uint8Array(288);
  (function () {
    var i;
    for (i = 0; i < 144; i++) LITLEN_LENGTHS[i] = 8;
    for (i = 144; i < 256; i++) LITLEN_LENGTHS[i] = 9;
    for (i = 256; i < 280; i++) LITLEN_LENGTHS[i] = 7;
    for (i = 280; i < 288; i++) LITLEN_LENGTHS[i] = 8;
  })();
  var DIST_LENGTHS = new Uint8Array(30).fill(5);

  var litLenRev = new Uint32Array(288);
  var distRev = new Uint32Array(30);
  var _LIT = buildCodes(LITLEN_LENGTHS), _DIS = buildCodes(DIST_LENGTHS);
  var s;
  for (s = 0; s < 288; s++) litLenRev[s] = reverseBits(_LIT.codes[s], LITLEN_LENGTHS[s]);
  for (s = 0; s < 30; s++) distRev[s] = reverseBits(_DIS.codes[s], DIST_LENGTHS[s]);

  var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  function emitLen(bw, len) {
    var idx = 0;
    while (idx < LEN_BASE.length - 1 && LEN_BASE[idx + 1] <= len) idx++;
    bw.writeBits(litLenRev[257 + idx], LITLEN_LENGTHS[257 + idx]);
    if (LEN_EXTRA[idx]) bw.writeBits(len - LEN_BASE[idx], LEN_EXTRA[idx]);
  }
  function emitDist(bw, dist) {
    var idx = 0;
    while (idx < DIST_BASE.length - 1 && DIST_BASE[idx + 1] <= dist) idx++;
    bw.writeBits(distRev[idx], DIST_LENGTHS[idx]);
    if (DIST_EXTRA[idx]) bw.writeBits(dist - DIST_BASE[idx], DIST_EXTRA[idx]);
  }

  /* ================= DEFLATE 压缩 ================= */
  function deflateInternal(data) {
    var n = data.length;
    var bw = new BitWriter();
    bw.writeBits(1, 1);            // BFINAL
    bw.writeBits(1, 2);            // BTYPE = 01（固定哈夫曼）

    var hashMask = 0x7FFF;
    var head = new Int32Array(0x8000);
    var prev = new Int32Array(n);
    var i;
    for (i = 0; i < 0x8000; i++) head[i] = -1;
    for (i = 0; i < n; i++) prev[i] = -1;
    var MAX_DIST = 32768, MAX_MATCH = 258, MIN_MATCH = 3, MAX_CHAIN = 32;

    i = 0;
    while (i < n) {
      var bestLen = 0, bestDist = 0;
      if (i + MIN_MATCH <= n) {
        var h = ((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) & hashMask;
        var cand = head[h], chain = 0;
        while (cand !== -1 && chain < MAX_CHAIN && i - cand <= MAX_DIST) {
          if (data[cand] === data[i] && data[cand + 1] === data[i + 1]) {
            var len = 2, maxLen = n - i;
            if (maxLen > MAX_MATCH) maxLen = MAX_MATCH;
            while (len < maxLen && data[cand + len] === data[i + len]) len++;
            if (len >= MIN_MATCH && len > bestLen) {
              bestLen = len; bestDist = i - cand;
              if (len === MAX_MATCH) break;
            }
          }
          cand = prev[cand];
          chain++;
        }
        prev[i] = head[h];
        head[h] = i;
      }
      if (bestLen >= MIN_MATCH) {
        emitLen(bw, bestLen);
        emitDist(bw, bestDist);
        i += bestLen;
      } else {
        bw.writeBits(litLenRev[data[i]], LITLEN_LENGTHS[data[i]]);
        i++;
      }
    }
    bw.writeBits(litLenRev[256], LITLEN_LENGTHS[256]);   // 块结束符
    return bw.finish();
  }

  /* ================= INFLATE 解压 ================= */
  function makeTree(lengths) {
    var bc = buildCodes(lengths);
    var map = new Map();
    var max = 0;
    for (var s = 0; s < lengths.length; s++) {
      var l = lengths[s];
      if (l) {
        map.set(reverseBits(bc.codes[s], l) + l * 4096, s);
        if (l > max) max = l;
      }
    }
    return { map: map, max: max };
  }
  function decodeSym(br, tree) {
    var code = 0;
    for (var len = 1; len <= tree.max; len++) {
      code |= br.read(1) << (len - 1);
      var sym = tree.map.get(code + len * 4096);
      if (sym !== undefined) return sym;
    }
    throw new Error('invalid huffman code');
  }
  function inflateBlock(br, out, litTree, distTree) {
    for (;;) {
      var sym = decodeSym(br, litTree);
      if (sym < 256) { out.push(sym); continue; }
      if (sym === 256) return;
      var li = sym - 257;
      if (li < 0 || li >= LEN_BASE.length) throw new Error('invalid length code');
      var len = LEN_BASE[li] + (LEN_EXTRA[li] ? br.read(LEN_EXTRA[li]) : 0);
      var ds = decodeSym(br, distTree);
      if (ds >= DIST_BASE.length) throw new Error('invalid distance code');
      var dist = DIST_BASE[ds] + (DIST_EXTRA[ds] ? br.read(DIST_EXTRA[ds]) : 0);
      // 匹配复制：逐字节从当前末尾往前 dist 处取，长度大于 dist 时自动延展（重叠匹配）
      for (var k = 0; k < len; k++) out.push(out[out.length - dist]);
    }
  }
  function inflateInternal(compressed) {
    var br = new BitReader(compressed);
    var out = [];
    for (;;) {
      var bfinal = br.read(1);
      var btype = br.read(2);
      if (btype === 0) {
        br.align();
        var len = br.read(16);
        br.read(16);                       // NLEN，此处不做校验
        for (var k = 0; k < len; k++) out.push(br.read(8));
      } else if (btype === 1) {
        inflateBlock(br, out, makeTree(LITLEN_LENGTHS), makeTree(DIST_LENGTHS));
      } else if (btype === 2) {
        var hl = br.read(5) + 257;
        var hd = br.read(5) + 1;
        var hc = br.read(4) + 4;
        var ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
        var clLen = new Array(19).fill(0);
        for (k = 0; k < hc; k++) clLen[ORDER[k]] = br.read(3);
        var lens = [];
        while (lens.length < hl + hd) {
          var sym = decodeSym(br, makeTree(clLen));
          var rep, j;
          if (sym < 16) { lens.push(sym); }
          else if (sym === 16) {
            if (!lens.length) throw new Error('invalid code length repeat');
            rep = 3 + br.read(2);
            for (j = 0; j < rep; j++) lens.push(lens[lens.length - 1]);
          } else if (sym === 17) {
            rep = 3 + br.read(3);
            for (j = 0; j < rep; j++) lens.push(0);
          } else {
            rep = 11 + br.read(7);
            for (j = 0; j < rep; j++) lens.push(0);
          }
        }
        var lit = lens.slice(0, hl);
        var dist = lens.slice(hl, hl + hd);
        inflateBlock(br, out, makeTree(lit), makeTree(dist));
      } else {
        throw new Error('invalid block type');
      }
      if (bfinal) break;
    }
    return new Uint8Array(out);
  }

  /* ================= 文本编解码 ================= */
  function utf8Encode(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.codePointAt(i);
      if (c > 0xFFFF) i++;
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else bytes.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(bytes);
  }
  function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    var str = '', i = 0;
    while (i < bytes.length) {
      var b = bytes[i];
      if (b < 0x80) { str += String.fromCharCode(b); i++; }
      else if (b < 0xE0) { str += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2; }
      else if (b < 0xF0) { str += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; }
      else { var cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); str += String.fromCodePoint(cp); i += 4; }
    }
    return str;
  }

  /* ================= ZIP 组装 ================= */
  function writeU16(arr, off, v) { arr[off] = v & 0xFF; arr[off + 1] = (v >>> 8) & 0xFF; }
  function writeU32(arr, off, v) {
    arr[off] = v & 0xFF; arr[off + 1] = (v >>> 8) & 0xFF;
    arr[off + 2] = (v >>> 16) & 0xFF; arr[off + 3] = (v >>> 24) & 0xFF;
  }
  function readU16(bytes, off) { return bytes[off] | (bytes[off + 1] << 8); }
  function readU32(bytes, off) { return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0; }

  /* ================= 编解码器选择 ================= */
  // 优先使用 pako（开源 zlib 移植，压缩率高、速度快）；未加载时回退到内置实现
  var codec = null;
  function getCodec() {
    if (codec) return codec;
    if (typeof pako !== 'undefined' && pako && typeof pako.deflate === 'function') {
      codec = {
        deflate: function (bytes) { return pako.deflate(bytes, { raw: true, level: 6 }); },
        inflate: function (bytes) { return pako.inflate(bytes, { raw: true }); },
      };
    } else {
      codec = { deflate: deflateInternal, inflate: inflateInternal };
    }
    return codec;
  }

  // entries: [{ name, data: Uint8Array }]，返回打包后的 Uint8Array
  function zipCreate(entries) {
    var local = [], central = [];
    var offset = 0, e;
    for (e = 0; e < entries.length; e++) {
      var ent = entries[e];
      var data = ent.data;
      var nameBytes = utf8Encode(ent.name);
      var crc = crc32(data);
      var comp = getCodec().deflate(data);
      var method, payload;
      if (comp.length < data.length) { method = 8; payload = comp; }
      else { method = 0; payload = data; }

      var lh = new Uint8Array(30 + nameBytes.length);
      writeU32(lh, 0, 0x04034b50);
      writeU16(lh, 4, 20); writeU16(lh, 6, 0);
      writeU16(lh, 8, method);
      writeU16(lh, 10, 0); writeU16(lh, 12, 0);
      writeU32(lh, 14, crc);
      writeU32(lh, 18, payload.length);
      writeU32(lh, 22, data.length);
      writeU16(lh, 26, nameBytes.length); writeU16(lh, 28, 0);
      lh.set(nameBytes, 30);
      local.push(lh, payload);

      var ch = new Uint8Array(46 + nameBytes.length);
      writeU32(ch, 0, 0x02014b50);
      writeU16(ch, 4, 20); writeU16(ch, 6, 20);
      writeU16(ch, 8, 0); writeU16(ch, 10, method);
      writeU16(ch, 12, 0); writeU16(ch, 14, 0);
      writeU32(ch, 16, crc);
      writeU32(ch, 20, payload.length);
      writeU32(ch, 24, data.length);
      writeU16(ch, 28, nameBytes.length);
      writeU16(ch, 30, 0); writeU16(ch, 32, 0);
      writeU16(ch, 34, 0); writeU16(ch, 36, 0);
      writeU32(ch, 38, 0); writeU32(ch, 42, offset);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += lh.length + payload.length;
    }

    var cdSize = 0;
    for (e = 0; e < central.length; e++) cdSize += central[e].length;
    var eocd = new Uint8Array(22);
    writeU32(eocd, 0, 0x06054b50);
    writeU16(eocd, 4, 0); writeU16(eocd, 6, 0);
    writeU16(eocd, 8, entries.length); writeU16(eocd, 10, entries.length);
    writeU32(eocd, 12, cdSize); writeU32(eocd, 16, offset);
    writeU16(eocd, 20, 0);

    var total = offset + cdSize + eocd.length;
    var zip = new Uint8Array(total), p = 0;
    for (e = 0; e < local.length; e++) { zip.set(local[e], p); p += local[e].length; }
    for (e = 0; e < central.length; e++) { zip.set(central[e], p); p += central[e].length; }
    zip.set(eocd, p);
    return zip;
  }

  // 解析 zip，返回 [{ name, data: Uint8Array }]
  function zipRead(zip) {
    var eocdPos = -1;
    for (var i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
      if (readU32(zip, i) === 0x06054b50) { eocdPos = i; break; }
    }
    if (eocdPos < 0) throw new Error('不是有效的 zip 文件');
    var count = readU16(zip, eocdPos + 10);
    var cdOff = readU32(zip, eocdPos + 16);
    var out = [], pos = cdOff;
    for (var e = 0; e < count; e++) {
      if (readU32(zip, pos) !== 0x02014b50) throw new Error('zip 中央目录损坏');
      var method = readU16(zip, pos + 10);
      var compSize = readU32(zip, pos + 20);
      var nameLen = readU16(zip, pos + 28);
      var extraLen = readU16(zip, pos + 30);
      var commentLen = readU16(zip, pos + 32);
      var localOff = readU32(zip, pos + 42);
      var name = utf8Decode(zip.subarray(pos + 46, pos + 46 + nameLen));

      var dataOff = localOff + 30 + nameLen + readU16(zip, localOff + 28);
      var compData = zip.subarray(dataOff, dataOff + compSize);
      var data;
      if (method === 0) data = compData.slice();
      else if (method === 8) data = getCodec().inflate(compData);
      else throw new Error('不支持的压缩方式: ' + method);
      out.push({ name: name, data: data });
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  return {
    zipCreate: zipCreate,
    zipRead: zipRead,
    crc32: crc32,
    deflate: function (b) { return getCodec().deflate(b); },
    inflate: function (b) { return getCodec().inflate(b); },
  };
});
