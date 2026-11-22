/**
 * 최소한의 ustar tar 인코더·디코더. 파일을 컨테이너에 넣고 꺼내는 데만 쓴다.
 * 호스트의 임시 파일이나 마운트 없이 표준 입출력으로 주고받기 위해 직접 만든다.
 */
import { toBytes, type SourceFileInput } from "@/domain/sandbox";

const BLOCK = 512;

function writeString(
  buffer: Buffer,
  offset: number,
  length: number,
  value: string,
) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength > length)
    throw new Error(`tar 필드가 너무 깁니다: ${value.slice(0, 40)}`);
  bytes.copy(buffer, offset);
}

function writeOctal(
  buffer: Buffer,
  offset: number,
  length: number,
  value: number,
) {
  writeString(
    buffer,
    offset,
    length,
    value.toString(8).padStart(length - 1, "0"),
  );
}

/** 이름이 100자를 넘으면 앞부분(prefix, 최대 155자)과 나눈다. 나눌 수 없으면 거부한다. */
function splitName(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155)
      return { name, prefix };
  }
  throw new Error(`경로가 너무 깁니다: ${path.slice(0, 60)}`);
}

export function encodeTar(files: SourceFileInput[], mode = 0o644): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    const content = Buffer.from(toBytes(file.content));
    const header = Buffer.alloc(BLOCK);
    const { name, prefix } = splitName(file.path);
    writeString(header, 0, 100, name);
    writeOctal(header, 100, 8, mode);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, content.byteLength);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156); // 검사합 계산 중에는 공백으로 채운다
    header[156] = "0".charCodeAt(0);
    writeString(header, 257, 6, "ustar");
    writeString(header, 263, 2, "00");
    writeString(header, 345, 155, prefix);
    let checksum = 0;
    for (const byte of header) checksum += byte;
    writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    parts.push(header, content);
    const padding = (BLOCK - (content.byteLength % BLOCK)) % BLOCK;
    if (padding > 0) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

function readString(buffer: Buffer, offset: number, length: number): string {
  const slice = buffer.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

/** 일반 파일만 꺼낸다. 폴더와 링크는 건너뛴다. */
export function decodeTar(data: Buffer): { path: string; content: Buffer }[] {
  const files: { path: string; content: Buffer }[] = [];
  let offset = 0;
  while (offset + BLOCK <= data.byteLength) {
    const header = data.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const size = Number.parseInt(readString(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || "0".charCodeAt(0));
    const start = offset + BLOCK;
    if (type === "0") {
      const path = (prefix ? `${prefix}/${name}` : name).replace(/^\.\//, "");
      files.push({
        path,
        content: Buffer.from(data.subarray(start, start + size)),
      });
    }
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}
