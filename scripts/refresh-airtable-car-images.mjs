import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

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
const WEBP_QUALITY = 86;
const DEFAULT_SIZE = { width: 1200, height: 800 };

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

function targetFromInstruction(instruction) {
  const customSize = instruction.match(/custom size\s+(\d+)x(\d+)/i);

  if (customSize) {
    return {
      width: Number(customSize[1]),
      height: Number(customSize[2]),
    };
  }

  return DEFAULT_SIZE;
}

function focalPoint(instruction) {
  const text = instruction.toLowerCase();

  if (text.includes('crop from the top')) {
    return { x: 0.5, y: 1 };
  }

  if (text.includes('crop from the bottom')) {
    return { x: 0.5, y: 0 };
  }

  if (text.includes('crop from the left')) {
    return { x: 1, y: 0.5 };
  }

  if (text.includes('crop from the right')) {
    return { x: 0, y: 0.5 };
  }

  return { x: 0.5, y: 0.5 };
}

function cropForCover(width, height, target, focus) {
  const targetRatio = target.width / target.height;
  const sourceRatio = width / height;

  if (sourceRatio > targetRatio) {
    const cropWidth = Math.floor(height * targetRatio);

    return {
      left: Math.round((width - cropWidth) * focus.x),
      top: 0,
      width: cropWidth,
      height,
    };
  }

  const cropHeight = Math.floor(width / targetRatio);

  return {
    left: 0,
    top: Math.round((height - cropHeight) * focus.y),
    width,
    height: cropHeight,
  };
}

async function optimise(record, tableData) {
  const { row, attachment, instruction } = record;
  const input = await sharp(await download(attachment.url), { failOn: 'none' }).rotate().toBuffer();
  const image = sharp(input, { failOn: 'none' });
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read image dimensions for ${row.id}`);
  }

  const target = targetFromInstruction(instruction);
  const focus = focalPoint(instruction);
  const crop = cropForCover(metadata.width, metadata.height, target, focus);
  const outputWidth = Math.min(target.width, crop.width);
  const outputHeight = Math.round(outputWidth * (target.height / target.width));
  const fileName = `${row.id}-${attachment.id}.webp`;
  const outputPath = path.join(ASSETS_DIR, fileName);

  await image
    .extract(crop)
    .resize(outputWidth, outputHeight, {
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: true,
    })
    .webp({
      quality: WEBP_QUALITY,
      effort: 6,
      smartSubsample: true,
    })
    .toFile(outputPath);

  const stats = await fs.stat(outputPath);

  row.cellValuesByColumnId[OUTPUT_FIELD_ID] = fileName;
  return {
    id: row.id,
    fileName,
    bytes: stats.size,
    width: outputWidth,
    height: outputHeight,
    instruction,
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
  .filter(({ instruction }) => instruction === '' || instruction.startsWith('//'));

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
    console.log(`OK ${update.id}: ${update.fileName} ${update.width}x${update.height} ${Math.round(update.bytes / 1024)} KB`);
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
