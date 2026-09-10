import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { renderCarImage, resolveCarImageRule, shouldRefreshCarImage } from './car-image-rules.mjs';

const TABLE_ID = 'tblbeY4fsrRxBNZ2l';
const IMAGE_FIELD_ID = 'fldS7fzV7FhfHuBws';
const OUTPUT_FIELD_ID = 'fldb3sM5XAQ4DV8f2';
const MAKE_FIELD_ID = 'fldxfFk98rxyXgF5e';
const MODEL_FIELD_ID = 'fldOg9NYiiFJm0hRx';
const YEAR_FIELD_ID = 'fldvCb8Kea2kJN4Fq';
const ASSETS_DIR = path.resolve('assets');
const PUBLIC_READ_JSON = process.env.AIRTABLE_PUBLIC_READ_JSON ?? '/private/tmp/airtable-public-read.json';
const UPDATED_PUBLIC_READ_JSON =
  process.env.AIRTABLE_UPDATED_PUBLIC_READ_JSON ?? '/private/tmp/airtable-public-read-cars-updated.json';
const UPDATES_JSON = process.env.AIRTABLE_UPDATES_JSON ?? '/private/tmp/airtable-car-image-updates.json';

async function download(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Download ${response.status} ${response.statusText}: ${url}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function readTable(payload) {
  const tableData = payload.data?.tableDatas?.find((table) => table.id === TABLE_ID);

  if (!tableData) {
    throw new Error(`Table data ${TABLE_ID} not found in ${PUBLIC_READ_JSON}`);
  }

  return tableData;
}

function signedAttachment(row, tableData) {
  const attachment = row.cellValuesByColumnId?.[IMAGE_FIELD_ID]?.[0];

  if (!attachment) {
    return null;
  }

  return {
    ...attachment,
    url: tableData.signedUserContentUrls?.[attachment.url] ?? attachment.url,
  };
}

async function optimise(record, tableData) {
  const { row, attachment, instruction } = record;
  const input = await sharp(await download(attachment.url), { failOn: 'none' }).rotate().toBuffer();
  const fileName = `${row.id}-${attachment.id}.webp`;
  const outputPath = path.join(ASSETS_DIR, fileName);
  const rule = resolveCarImageRule(row.id, instruction);
  const output = await renderCarImage(input, outputPath, rule);

  const stats = await fs.stat(outputPath);

  row.cellValuesByColumnId[OUTPUT_FIELD_ID] = fileName;
  return {
    id: row.id,
    fileName,
    bytes: stats.size,
    width: output.width,
    height: output.height,
    mode: output.mode,
    hasInstruction: rule.hasInstruction,
    hasOverride: rule.hasOverride,
    instruction: rule.instruction,
    label: [
      row.cellValuesByColumnId?.[YEAR_FIELD_ID],
      row.cellValuesByColumnId?.[MAKE_FIELD_ID],
      row.cellValuesByColumnId?.[MODEL_FIELD_ID],
    ]
      .filter(Boolean)
      .join(' '),
    fields: {
      [OUTPUT_FIELD_ID]: fileName,
    },
  };
}

await fs.mkdir(ASSETS_DIR, { recursive: true });

const payload = JSON.parse(await fs.readFile(PUBLIC_READ_JSON, 'utf8'));
const tableData = readTable(payload);
const selected = tableData.rows
  .map((row) => {
    const instruction = String(row.cellValuesByColumnId?.[OUTPUT_FIELD_ID] ?? '').trim();

    return {
      row,
      attachment: signedAttachment(row, tableData),
      instruction,
    };
  })
  .filter(({ row, instruction }) => shouldRefreshCarImage(row.id, instruction));

console.log(`Selected ${selected.length} car records`);

const updates = [];
const failed = [];

for (const record of selected) {
  try {
    if (!record.attachment?.url) {
      throw new Error('No attachment URL');
    }

    const update = await optimise(record, tableData);
    updates.push(update);
    const source = update.hasOverride ? 'override' : update.hasInstruction ? 'instruction' : 'default';
    console.log(
      `OK ${update.id}: ${update.fileName} ${update.width}x${update.height} ${update.mode}/${source} ${Math.round(
        update.bytes / 1024,
      )} KB`,
    );
  } catch (error) {
    failed.push({
      id: record.row.id,
      error: error.message,
    });
    console.error(`FAIL ${record.row.id}: ${error.message}`);
  }
}

if (failed.length > 0) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}

await fs.writeFile(UPDATED_PUBLIC_READ_JSON, JSON.stringify(payload, null, 2), 'utf8');
await fs.writeFile(UPDATES_JSON, JSON.stringify(updates, null, 2), 'utf8');

const totalBytes = updates.reduce((sum, update) => sum + update.bytes, 0);
console.log(`Wrote ${updates.length} WebP files to ${ASSETS_DIR}`);
console.log(`Wrote Airtable update manifest to ${UPDATES_JSON}`);
console.log(`Wrote updated public read JSON to ${UPDATED_PUBLIC_READ_JSON}`);
console.log(`Total output size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
