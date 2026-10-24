import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/** 各平台解压顺序。node 不调用外部命令，macOS / Linux / Windows 都能用。 */
export function unzipTools(platform = process.platform) {
  if (platform === "win32") return ["tar", "powershell", "node"];
  return ["tar", "unzip", "python3", "bsdtar", "node"];
}

function safeZipName(name) {
  if (/^(?:[/\\]|[A-Za-z]:)/.test(String(name || ''))) throw new Error('zip 路径不合法');
  const rel = String(name || "").replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
  if (!rel) return "";
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) throw new Error("zip 路径不合法");
  const parts = rel.split("/");
  if (parts.some((part) => part === ".." || part === "")) throw new Error("zip 路径不合法");
  return parts.join("/");
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("不是 zip");
}

function readZipEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error("不是 zip");
  const eocd = findEocd(buf);
  const total = buf.readUInt16LE(eocd + 10);
  let cursor = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < total; n += 1) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("zip 目录损坏");
    }
    const method = buf.readUInt16LE(cursor + 10);
    if (buf.readUInt16LE(cursor + 8) & 1) throw new Error('不支持加密 zip');
    const crc = buf.readUInt32LE(cursor + 16);
    const compSize = buf.readUInt32LE(cursor + 20);
    const size = buf.readUInt32LE(cursor + 24);
    const unixType = (buf.readUInt32LE(cursor + 38) >>> 16) & 0xf000;
    if (unixType === 0xa000) throw new Error('zip 不允许符号链接');
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.toString("utf8", cursor + 46, cursor + 46 + nameLen);
    entries.push({ name, method, compSize, size, localOffset, crc });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function listZipEntries(buf) {
  return readZipEntries(buf).map((entry) => entry.name.replace(/\\/g, "/"));
}

export function listZipFile(zipPath) {
  return listZipEntries(fs.readFileSync(zipPath));
}

function localDataOffset(buf, localOffset) {
  if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error("zip 本地头损坏");
  }
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  return localOffset + 30 + nameLen + extraLen;
}

export function extractZipBuffer(buf, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const root = path.resolve(dest);
  let expanded = 0;
  const entries = readZipEntries(buf);
  if (entries.length > 20000) throw new Error('zip 文件数量超限');
  for (const entry of entries) {
    const rel = safeZipName(entry.name);
    if (!rel) continue;
    expanded += entry.size;
    if (expanded > 128 * 1024 * 1024) throw new Error('zip 解压大小超限');
    if (entry.name.endsWith('/')) { fs.mkdirSync(path.join(root, rel), { recursive: true }); continue; }
    if (entry.compSize === 0xffffffff || entry.localOffset === 0xffffffff) {
      throw new Error("不支持 zip64");
    }
    if (entry.method !== 0 && entry.method !== 8) {
      throw new Error(`不支持的 zip 压缩方式 ${entry.method}`);
    }
    const start = localDataOffset(buf, entry.localOffset);
    const end = start + entry.compSize;
    if (end > buf.length) throw new Error("zip 数据被截断");
    const compressed = buf.subarray(start, end);
    const body = entry.method === 0 ? compressed : zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) });
    if (body.length !== entry.size) throw new Error('zip 文件大小不匹配');
    if (zlib.crc32(body) !== entry.crc) throw new Error('zip CRC 校验失败');
    const out = path.resolve(root, rel);
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (out !== root && !out.startsWith(prefix)) throw new Error("zip 路径不合法");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, body);
  }
}

/** Bounded, validated extraction; the legacy tools argument is ignored. */
export function extractZipArchive(zipPath, dest, _tools) {
  // The bounded in-process implementation is the only extraction path. An
  // external tar/unzip would bypass our path, symlink and expansion checks.
  extractZipBuffer(fs.readFileSync(zipPath), dest);
  return 'node';
}
