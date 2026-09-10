import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_ID = 'app1SfYuOy4gWl55g';
const CARS_TABLE_ID = 'tblbeY4fsrRxBNZ2l';
const SYMBOLS_TABLE_ID = 'tbl5gIhdPEfHfd5ay';
const DATA_DIR = path.resolve('data');
const ASSETS_DIR = path.resolve('assets');
const OUTPUT_PATH = path.join(DATA_DIR, 'eras.js');
const PUBLIC_READ_JSON = process.env.AIRTABLE_PUBLIC_READ_JSON ?? '/private/tmp/airtable-public-read.json';
const SYMBOLS_PUBLIC_READ_JSON = process.env.AIRTABLE_SYMBOLS_PUBLIC_READ_JSON ?? '/private/tmp/airtable-public-read-symbols.json';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage: npm run import:content

Environment:
  AIRTABLE_TOKEN             Read records from Airtable API when set.
  AIRTABLE_PUBLIC_READ_JSON  Read exported public Airtable JSON when AIRTABLE_TOKEN is not set.
`);
  process.exit(0);
}

const CAR_FIELD_IDS = {
  model: 'fldOg9NYiiFJm0hRx',
  image: 'fldS7fzV7FhfHuBws',
  region: 'fldku0iNKI80VRpPN',
  country: 'fldD21KCw24PNKaID',
  year: 'fldvCb8Kea2kJN4Fq',
  make: 'fldxfFk98rxyXgF5e',
  era: 'fldoede2b5RIE8kQS',
  optimisedFileName: 'fldb3sM5XAQ4DV8f2',
};

const SYMBOL_FIELD_IDS = {
  name: 'fldafwIFSPSlftAIU',
  era: 'flddEfMsellRXNVuz',
  optimisedFileName: 'fldTAniJoyHepvlF8',
  image: 'fld9DWxOf6iwJDjcA',
};

const REGIONS_BY_SELECT_ID = {
  sel2hx40XuIECEa6U: 'Americas',
  sel4zhvGOKZLmZETj: 'Europe',
  sel1jVPUfxeSsOnbT: 'Asia',
};

const ERAS = [
  { id: 'pioneers', label: 'Pioneers', airtableName: 'Pioneers (1900–1938)', years: ['1900', '1910', '1920', '1930'] },
  { id: 'postwar-modernism', label: 'Postwar Modern', airtableName: 'Postwar Modern (1939–1959)', years: ['1940', '1950'] },
  { id: 'space-age', label: 'Space Age', airtableName: 'Space Age (1960–1973)', years: ['1960'] },
  { id: 'wedge-era', label: 'Wedge Era', airtableName: 'Wedge Era (1974–1986)', years: ['1970', '1980'] },
  { id: 'analog-future', label: 'Analog Future', airtableName: 'Analog Future (1987–1999)', years: ['1990'] },
  { id: 'new-millennium', label: 'Millennium', airtableName: 'Millennium (2000–2012)', years: ['2000'] },
  { id: 'electric-age', label: 'Electric Age', airtableName: 'Electric Age (2013–…)', years: ['2010', '2020', '2030'] },
];

const token = process.env.AIRTABLE_TOKEN;

async function airtableRequest(url) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Airtable ${response.status} ${response.statusText}: ${text}`);
  }

  return response.json();
}

async function listRecordsFromApi(tableId, fieldIds) {
  const records = [];
  let offset;

  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('returnFieldsByFieldId', 'true');
    for (const fieldId of Object.values(fieldIds)) {
      url.searchParams.append('fields[]', fieldId);
    }
    if (offset) {
      url.searchParams.set('offset', offset);
    }

    const page = await airtableRequest(url);
    records.push(...page.records.map((record) => ({ id: record.id, fields: record.fields })));
    offset = page.offset;
  } while (offset);

  return records;
}

async function listRecordsFromPublicJson(filePath, tableId) {
  const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const tableData = payload.data?.tableDatas?.find((table) => table.id === tableId);

  if (!tableData) {
    throw new Error(`Table data ${tableId} not found in ${filePath}`);
  }

  return tableData.rows.map((row) => ({ id: row.id, fields: row.cellValuesByColumnId ?? {} }));
}

async function listRecords(tableId, fieldIds, filePath) {
  if (token) {
    return listRecordsFromApi(tableId, fieldIds);
  }

  return listRecordsFromPublicJson(filePath, tableId);
}

function readField(fields, fieldIds, key) {
  return fields[key] ?? fields[fieldIds[key]];
}

function readAttachment(fields, fieldIds) {
  const attachments = readField(fields, fieldIds, 'image');
  return Array.isArray(attachments) ? attachments[0] : null;
}

function readOptimisedFileName(fields, fieldIds) {
  const value = String(readField(fields, fieldIds, 'optimisedFileName') ?? '').trim();
  return value.endsWith('.webp') ? value : '';
}

function normaliseCarRecord(record) {
  const fields = record.fields;
  const attachment = readAttachment(fields, CAR_FIELD_IDS);
  const image = readOptimisedFileName(fields, CAR_FIELD_IDS) || (attachment ? `${record.id}-${attachment.id}.webp` : '');
  const region =
    REGIONS_BY_SELECT_ID[readField(fields, CAR_FIELD_IDS, 'region')] ??
    String(readField(fields, CAR_FIELD_IDS, 'region') ?? '');
  const country = String(readField(fields, CAR_FIELD_IDS, 'country') ?? region);

  return {
    id: record.id,
    make: String(readField(fields, CAR_FIELD_IDS, 'make') ?? ''),
    model: String(readField(fields, CAR_FIELD_IDS, 'model') ?? ''),
    year: String(readField(fields, CAR_FIELD_IDS, 'year') ?? ''),
    country,
    era: String(readField(fields, CAR_FIELD_IDS, 'era') ?? ''),
    image,
  };
}

function normaliseSymbolRecord(record) {
  const fields = record.fields;
  const attachment = readAttachment(fields, SYMBOL_FIELD_IDS);
  const image = readOptimisedFileName(fields, SYMBOL_FIELD_IDS) || (attachment ? `${record.id}-${attachment.id}.webp` : '');

  return {
    id: record.id,
    name: String(readField(fields, SYMBOL_FIELD_IDS, 'name') ?? ''),
    era: String(readField(fields, SYMBOL_FIELD_IDS, 'era') ?? ''),
    image,
    width: Number(attachment?.width) || 1,
    height: Number(attachment?.height) || 1,
  };
}

function byCarDateAndName(left, right) {
  return (
    Number(left.year) - Number(right.year) ||
    left.make.localeCompare(right.make) ||
    left.model.localeCompare(right.model)
  );
}

async function assertAssetsExist(eras) {
  const files = new Set(await fs.readdir(ASSETS_DIR));
  const missing = eras.flatMap((era) =>
    [...era.cars, ...era.symbols].filter((item) => !files.has(item.image)).map((item) => `${item.id}: ${item.image}`),
  );

  if (missing.length > 0) {
    throw new Error(`Missing ${missing.length} asset files:\n${missing.join('\n')}`);
  }
}

function buildEras(carRecords, symbolRecords) {
  const cars = carRecords.map(normaliseCarRecord).filter((car) => car.image && car.make && car.year);
  const symbols = symbolRecords.map(normaliseSymbolRecord).filter((symbol) => symbol.image && symbol.name && symbol.era);

  return ERAS.map((era) => ({
    id: era.id,
    label: era.label,
    years: era.years,
    cars: cars
      .filter((car) => car.era === era.airtableName)
      .sort(byCarDateAndName)
      .map(({ era: _era, ...car }) => car),
    symbols: symbols
      .filter((symbol) => symbol.era === era.label)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ era: _era, ...symbol }) => symbol),
  }));
}

function renderDataFile(eras) {
  return `window.EPIC_CARS_DEFAULT_ERA_ID = 'pioneers';
window.EPIC_CARS_ERAS = ${JSON.stringify(eras, null, 2)};
`;
}

await fs.mkdir(DATA_DIR, { recursive: true });

const eras = buildEras(
  await listRecords(CARS_TABLE_ID, CAR_FIELD_IDS, PUBLIC_READ_JSON),
  await listRecords(SYMBOLS_TABLE_ID, SYMBOL_FIELD_IDS, SYMBOLS_PUBLIC_READ_JSON),
);
await assertAssetsExist(eras);
await fs.writeFile(OUTPUT_PATH, renderDataFile(eras), 'utf8');

const total = eras.reduce((sum, era) => sum + era.cars.length, 0);
const totalSymbols = eras.reduce((sum, era) => sum + era.symbols.length, 0);
console.log(`Wrote ${total} cars and ${totalSymbols} symbols across ${eras.length} eras to ${OUTPUT_PATH}`);
for (const era of eras) {
  console.log(`${era.label}: ${era.cars.length} cars, ${era.symbols.length} symbols`);
}
