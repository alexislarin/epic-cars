import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { carImageOverrideIds, renderCarImage, resolveCarImageRule } from './car-image-rules.mjs';

const TABLE_ID = 'tblbeY4fsrRxBNZ2l';
const IMAGE_FIELD_ID = 'fldS7fzV7FhfHuBws';
const ASSETS_DIR = path.resolve('assets');
const PUBLIC_READ_JSON = process.env.AIRTABLE_PUBLIC_READ_JSON;

if (!PUBLIC_READ_JSON) {
  console.error('Missing AIRTABLE_PUBLIC_READ_JSON.');
  process.exit(1);
}

async function download(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Download ${response.status} ${response.statusText}: ${url}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function listRecords() {
  const payload = JSON.parse(await fs.readFile(PUBLIC_READ_JSON, 'utf8'));
  const tableData = payload.data?.tableDatas?.find((table) => table.id === TABLE_ID);

  if (!tableData) {
    throw new Error(`Table data ${TABLE_ID} not found in ${PUBLIC_READ_JSON}`);
  }

  return tableData.rows.map((row) => {
    const attachment = row.cellValuesByColumnId?.[IMAGE_FIELD_ID]?.[0];
    const signedUrl = attachment ? tableData.signedUserContentUrls?.[attachment.url] : null;

    return {
      id: row.id,
      attachment: attachment ? { ...attachment, url: signedUrl ?? attachment.url } : null,
    };
  });
}

await fs.mkdir(ASSETS_DIR, { recursive: true });

const recordsById = new Map((await listRecords()).map((record) => [record.id, record]));
const failed = [];

for (const id of carImageOverrideIds()) {
  try {
    const record = recordsById.get(id);

    if (!record?.attachment?.url) {
      throw new Error('No attachment URL');
    }

    const fileName = `${record.id}-${record.attachment.id}.webp`;
    const outputPath = path.join(ASSETS_DIR, fileName);
    const input = await sharp(await download(record.attachment.url), { failOn: 'none' }).rotate().toBuffer();
    const output = await renderCarImage(input, outputPath, resolveCarImageRule(id));

    const stats = await fs.stat(outputPath);
    console.log(`OK ${id}: ${fileName} ${output.width}x${output.height} ${Math.round(stats.size / 1024)} KB (${output.mode})`);
  } catch (error) {
    failed.push({ id, error: error.message });
    console.error(`FAIL ${id}: ${error.message}`);
  }
}

if (failed.length > 0) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}

console.log(`Repaired ${carImageOverrideIds().length} images`);
