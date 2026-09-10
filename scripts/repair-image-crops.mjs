import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const TABLE_ID = 'tblbeY4fsrRxBNZ2l';
const IMAGE_FIELD_ID = 'fldS7fzV7FhfHuBws';
const ASSETS_DIR = path.resolve('assets');
const TARGET_RATIO = 3 / 2;
const TARGET_WIDTH = 1200;
const TARGET_HEIGHT = Math.round(TARGET_WIDTH / TARGET_RATIO);
const WEBP_QUALITY = 86;
const PUBLIC_READ_JSON = process.env.AIRTABLE_PUBLIC_READ_JSON;

const cropRepairs = {
  rec0vcUzCwjYDjG0R: { mode: 'contain' },
  rec40KzSZ0KGibypX: { mode: 'contain' },
  rec7Ja8p7sMbcM5wN: { mode: 'contain' },
  rec9TjLXob85jhgmg: { mode: 'cover', x: 0 },
  recEecRTQVxb99boR: { mode: 'contain' },
  recEnqgKW83SD8JiB: { mode: 'cover', x: 1 },
  recJNucojmjwql69B: { mode: 'contain' },
  recLD8k0UI7kuWBLt: { mode: 'contain' },
  recX4ibHBwzdW7GA0: { mode: 'contain' },
  recYeVnWbPMhZUP3R: { mode: 'contain' },
  recoTw3a9HXkAFbYg: { mode: 'contain' },
  recsY8Ve26Tejm1jf: { mode: 'contain' },
  recu9M490cUdoJOBe: { mode: 'contain' },
  recxzMVUovjzuYzg2: { mode: 'contain' },
  recykNerxwJmuQYSX: { mode: 'contain' },
};

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

function cropForCover(width, height, repair) {
  const sourceRatio = width / height;

  if (sourceRatio > TARGET_RATIO) {
    const cropWidth = Math.floor(height * TARGET_RATIO);
    return {
      left: Math.round((width - cropWidth) * (repair.x ?? 0.5)),
      top: 0,
      width: cropWidth,
      height,
    };
  }

  const cropHeight = Math.floor(width / TARGET_RATIO);
  return {
    left: 0,
    top: Math.round((height - cropHeight) * (repair.y ?? 0.5)),
    width,
    height: cropHeight,
  };
}

async function renderContain(input, outputPath) {
  const metadata = await sharp(input, { failOn: 'none' }).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read image dimensions');
  }

  const scale = Math.min(TARGET_WIDTH / metadata.width, TARGET_HEIGHT / metadata.height);
  const foregroundWidth = Math.round(metadata.width * scale);
  const foregroundHeight = Math.round(metadata.height * scale);
  const background = await sharp(input, { failOn: 'none' })
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'cover', position: 'centre' })
    .blur(24)
    .modulate({ brightness: 0.78, saturation: 0.85 })
    .toBuffer();

  const foreground = await sharp(input, { failOn: 'none' })
    .resize(foregroundWidth, foregroundHeight, { fit: 'inside' })
    .toBuffer();

  await sharp(background, { failOn: 'none' })
    .composite([
      {
        input: foreground,
        left: Math.round((TARGET_WIDTH - foregroundWidth) / 2),
        top: Math.round((TARGET_HEIGHT - foregroundHeight) / 2),
      },
    ])
    .webp({ quality: WEBP_QUALITY, effort: 6, smartSubsample: true })
    .toFile(outputPath);
}

async function renderCover(input, outputPath, repair) {
  const image = sharp(input, { failOn: 'none' });
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read image dimensions');
  }

  await image
    .extract(cropForCover(metadata.width, metadata.height, repair))
    .resize(TARGET_WIDTH, TARGET_HEIGHT, {
      fit: 'cover',
      position: 'centre',
    })
    .webp({ quality: WEBP_QUALITY, effort: 6, smartSubsample: true })
    .toFile(outputPath);
}

await fs.mkdir(ASSETS_DIR, { recursive: true });

const recordsById = new Map((await listRecords()).map((record) => [record.id, record]));
const failed = [];

for (const [id, repair] of Object.entries(cropRepairs)) {
  try {
    const record = recordsById.get(id);

    if (!record?.attachment?.url) {
      throw new Error('No attachment URL');
    }

    const fileName = `${record.id}-${record.attachment.id}.webp`;
    const outputPath = path.join(ASSETS_DIR, fileName);
    const input = await sharp(await download(record.attachment.url), { failOn: 'none' }).rotate().toBuffer();

    if (repair.mode === 'contain') {
      await renderContain(input, outputPath);
    } else {
      await renderCover(input, outputPath, repair);
    }

    const stats = await fs.stat(outputPath);
    console.log(`OK ${id}: ${fileName} ${Math.round(stats.size / 1024)} KB (${repair.mode})`);
  } catch (error) {
    failed.push({ id, error: error.message });
    console.error(`FAIL ${id}: ${error.message}`);
  }
}

if (failed.length > 0) {
  console.error(JSON.stringify(failed, null, 2));
  process.exit(1);
}

console.log(`Repaired ${Object.keys(cropRepairs).length} images`);
