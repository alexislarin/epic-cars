import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { renderCarImage, resolveCarImageRule } from './car-image-rules.mjs';

const BASE_ID = 'app1SfYuOy4gWl55g';
const TABLE_ID = 'tblbeY4fsrRxBNZ2l';
const IMAGE_FIELD = 'Image';
const OUTPUT_FIELD = 'Optimised file name';
const IMAGE_FIELD_ID = 'fldS7fzV7FhfHuBws';
const ASSETS_DIR = path.resolve('assets');
const PUBLIC_READ_JSON = process.env.AIRTABLE_PUBLIC_READ_JSON;
const UPDATES_JSON = process.env.AIRTABLE_UPDATES_JSON ?? '/private/tmp/airtable-image-updates.json';

const token = process.env.AIRTABLE_TOKEN;

if (!token && !PUBLIC_READ_JSON) {
  console.error('Missing AIRTABLE_TOKEN or AIRTABLE_PUBLIC_READ_JSON.');
  process.exit(1);
}

async function airtableRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Airtable ${response.status} ${response.statusText}: ${text}`);
  }

  return response.json();
}

async function listRecords() {
  if (PUBLIC_READ_JSON) {
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
        fields: {
          [IMAGE_FIELD]: attachment ? [{ ...attachment, url: signedUrl ?? attachment.url }] : [],
          [OUTPUT_FIELD]: row.cellValuesByColumnId?.fldb3sM5XAQ4DV8f2,
        },
      };
    });
  }

  const records = [];
  let offset;

  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.append('fields[]', IMAGE_FIELD);
    url.searchParams.append('fields[]', OUTPUT_FIELD);
    if (offset) {
      url.searchParams.set('offset', offset);
    }

    const page = await airtableRequest(url);
    records.push(...page.records);
    offset = page.offset;
  } while (offset);

  return records;
}

async function download(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Download ${response.status} ${response.statusText}: ${url}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function optimiseRecord(record) {
  const attachment = record.fields?.[IMAGE_FIELD]?.[0];

  if (!attachment?.url) {
    return { id: record.id, skipped: true, reason: 'no image' };
  }

  const fileName = `${record.id}-${attachment.id}.webp`;
  const outputPath = path.join(ASSETS_DIR, fileName);
  const normalised = await sharp(await download(attachment.url), { failOn: 'none' }).rotate().toBuffer();
  const rule = resolveCarImageRule(record.id, record.fields?.[OUTPUT_FIELD]);
  const output = await renderCarImage(normalised, outputPath, rule);

  const stats = await fs.stat(outputPath);
  return {
    id: record.id,
    fileName,
    bytes: stats.size,
    width: output.width,
    height: output.height,
    mode: output.mode,
    hasInstruction: rule.hasInstruction,
    hasOverride: rule.hasOverride,
  };
}

async function updateRecords(updates) {
  if (!token) {
    await fs.writeFile(UPDATES_JSON, JSON.stringify(updates, null, 2), 'utf8');
    console.log(`Wrote Airtable update manifest to ${UPDATES_JSON}`);
    return;
  }

  for (let index = 0; index < updates.length; index += 10) {
    const chunk = updates.slice(index, index + 10);
    await airtableRequest(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({
        records: chunk.map((update) => ({
          id: update.id,
          fields: { [OUTPUT_FIELD]: update.fileName },
        })),
      }),
    });
  }
}

await fs.mkdir(ASSETS_DIR, { recursive: true });

const records = await listRecords();
console.log(`Loaded ${records.length} records`);

const updates = [];
const skipped = [];
const failed = [];

for (const record of records) {
  try {
    const result = await optimiseRecord(record);
    if (result.skipped) {
      skipped.push(result);
      console.log(`SKIP ${record.id}: ${result.reason}`);
    } else {
      updates.push(result);
      const source = result.hasOverride ? 'override' : result.hasInstruction ? 'instruction' : 'default';
      console.log(
        `OK ${record.id}: ${result.fileName} ${result.width}x${result.height} ${result.mode}/${source} ${Math.round(
          result.bytes / 1024,
        )} KB`,
      );
    }
  } catch (error) {
    failed.push({ id: record.id, error: error.message });
    console.error(`FAIL ${record.id}: ${error.message}`);
  }
}

if (failed.length > 0) {
  console.error(`Not updating Airtable because ${failed.length} records failed.`);
  process.exit(1);
}

await updateRecords(updates);

const totalBytes = updates.reduce((sum, update) => sum + update.bytes, 0);
console.log(`Updated ${updates.length} records`);
console.log(`Skipped ${skipped.length} records`);
console.log(`Wrote ${updates.length} WebP files to ${ASSETS_DIR}`);
console.log(`Total output size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
