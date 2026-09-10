import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const BASE_ID = 'app1SfYuOy4gWl55g';
const TABLE_ID = 'tbl5gIhdPEfHfd5ay';
const IMAGE_FIELD = 'Image';
const OUTPUT_FIELD = 'Optimised file name';
const ASSETS_DIR = path.resolve('assets');
const MAX_LONG_SIDE = 1200;
const WEBP_QUALITY = 75;
const RECORDS_JSON = process.env.AIRTABLE_SYMBOLS_RECORDS_JSON;
const UPDATES_JSON = process.env.AIRTABLE_UPDATES_JSON ?? '/private/tmp/airtable-symbols-image-updates.json';

const token = process.env.AIRTABLE_TOKEN;

if (!token && !RECORDS_JSON) {
  console.error('Missing AIRTABLE_TOKEN or AIRTABLE_SYMBOLS_RECORDS_JSON.');
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

async function listRecordsFromApi() {
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

async function listRecordsFromJson() {
  return JSON.parse(await fs.readFile(RECORDS_JSON, 'utf8'));
}

async function listRecords() {
  if (RECORDS_JSON) {
    return listRecordsFromJson();
  }

  return listRecordsFromApi();
}

async function download(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Download ${response.status} ${response.statusText}: ${url}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function readAttachment(record) {
  const fields = record.fields ?? record.cellValuesByFieldId ?? {};
  const attachments = fields[IMAGE_FIELD] ?? fields.fld9DWxOf6iwJDjcA;
  return Array.isArray(attachments) ? attachments[0] : null;
}

async function optimiseRecord(record) {
  const attachment = readAttachment(record);

  if (!attachment?.url) {
    return { id: record.id, skipped: true, reason: 'no image' };
  }

  const fileName = `${record.id}-${attachment.id}.webp`;
  const outputPath = path.join(ASSETS_DIR, fileName);
  const input = await sharp(await download(attachment.url), { failOn: 'none' }).rotate().toBuffer();
  const metadata = await sharp(input, { failOn: 'none' }).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read image dimensions for ${record.id}`);
  }

  await sharp(input, { failOn: 'none' })
    .resize({
      width: MAX_LONG_SIDE,
      height: MAX_LONG_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({
      quality: WEBP_QUALITY,
      effort: 6,
      smartSubsample: true,
    })
    .toFile(outputPath);

  const outputMetadata = await sharp(outputPath, { failOn: 'none' }).metadata();
  const stats = await fs.stat(outputPath);

  return {
    id: record.id,
    fileName,
    bytes: stats.size,
    input: `${metadata.width}x${metadata.height}`,
    output: `${outputMetadata.width}x${outputMetadata.height}`,
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
console.log(`Loaded ${records.length} symbol records`);

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
      console.log(
        `OK ${record.id}: ${result.fileName} ${result.input} -> ${result.output} ${Math.round(result.bytes / 1024)} KB`,
      );
    }
  } catch (error) {
    failed.push({ id: record.id, error: error.message });
    console.error(`FAIL ${record.id}: ${error.message}`);
  }
}

if (failed.length > 0) {
  console.error(`Not updating Airtable because ${failed.length} records failed.`);
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}

await updateRecords(updates);

const totalBytes = updates.reduce((sum, update) => sum + update.bytes, 0);
console.log(`Updated ${updates.length} records`);
console.log(`Skipped ${skipped.length} records`);
console.log(`Wrote ${updates.length} WebP files to ${ASSETS_DIR}`);
console.log(`Total output size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
