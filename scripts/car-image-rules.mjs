import sharp from 'sharp';

export const DEFAULT_CAR_IMAGE_SIZE = { width: 1200, height: 800 };
export const CAR_IMAGE_ENCODING = {
  quality: 75,
  effort: 6,
  smartSubsample: true,
};

const CAR_IMAGE_OVERRIDES = {
  // These images must use a true crop; contain adds a blurred artificial background.
  rec0vcUzCwjYDjG0R: { mode: 'cover' },
  rec40KzSZ0KGibypX: { mode: 'cover' },
  rec7Ja8p7sMbcM5wN: { mode: 'cover' },
  rec9TjLXob85jhgmg: { mode: 'cover', focus: { x: 0, y: 0.5 } },
  recEecRTQVxb99boR: { mode: 'cover' },
  recEnqgKW83SD8JiB: { mode: 'cover', focus: { x: 1, y: 0.5 } },
  recJNucojmjwql69B: { mode: 'contain' },
  recLD8k0UI7kuWBLt: { mode: 'contain' },
  recX4ibHBwzdW7GA0: { mode: 'cover' },
  recYeVnWbPMhZUP3R: { mode: 'cover' },
  recoTw3a9HXkAFbYg: { mode: 'contain' },
  recsY8Ve26Tejm1jf: { mode: 'cover' },
  recu9M490cUdoJOBe: { mode: 'cover' },
  recxzMVUovjzuYzg2: { mode: 'contain' },
  recykNerxwJmuQYSX: { mode: 'contain' },
};

const CAR_IMAGE_INSTRUCTIONS = {
  recgTOOajuYi6em62: '// crop from the top',
  recHWNw7qOxN6dqnf: '// crop from the top',
  reca8RL8BEwdNhVEi: '// crop from the top',
  recLYb1bX7ihQTTPs: '// custom size 1600x800, crop from the top',
  recGFZVV3phqqOSIA: '// crop from the top',
  rec5lEnsP91HhAbyg: '// crop from the bottom',
  recEUCeoBtBWNGZmN: '// crop from the top',
  recbSbrQfiVtv23H9: '// crop from the right',
  reciKEp0jdg6w9lUJ: '// crop from the top',
  recH3aQWWZO5t7HwA: '// crop from the top',
  recNKY2yl9URH7s2N: '// crop from the left',
  rec12JRKeL7S15zSb: '// crop from the right',
  recSGhbyrrawkLu1h: '// crop from the top',
  rec3o8QaEQqke2Rrg: '// crop from the top',
  rec2k1cseAiFhC220: '// crop from the top',
  reccGz9AxjOp8D01b: '// crop from the right',
  recEASdfUMWsYOGnL: '// crop from the top',
  rec2k2Mtth3P6ZTRX: '// crop from the left',
  recHlsWWFFo4KnwMx: '// crop from the top',
  recmkneCvu6902Nva: '// crop from the top',
  recDEVNfJROJiRcxE: '// crop from the top',
  rec1k19E6P5HwvPgl: '// crop from the top',
  recGMsUFrWaX6Q0r0: '// crop from the left',
  recgYKhuJAKpe2Rcw: '// crop from the top',
  rec7Fwct5PyWjzMNP: '// crop from the top',
  rec9TjLXob85jhgmg: '// crop from the top',
  recUSMerrHyDG9uTU: '// crop from the top',
  recB6Deii90DQZuuX: '// crop from the top',
  recf12F47iMxjXTEi: '// crop from the left',
  recZrn49mJDuSLBDo: '// crop from the top',
  rec90bOSNsdiXgD3x: '// crop from the right',
};

export function carImageOverrideIds() {
  return Object.keys(CAR_IMAGE_OVERRIDES);
}

export function hasCarImageInstruction(recordId) {
  return Boolean(CAR_IMAGE_INSTRUCTIONS[recordId]);
}

export function hasCarImageOverride(recordId) {
  return Boolean(CAR_IMAGE_OVERRIDES[recordId]);
}

export function shouldRefreshCarImage(recordId, instruction) {
  const text = String(instruction ?? '').trim();
  return (
    text === '' ||
    text.startsWith('//') ||
    hasCarImageInstruction(recordId) ||
    hasCarImageOverride(recordId)
  );
}

function targetFromInstruction(instruction) {
  const customSize = instruction.match(/custom size\s+(\d+)x(\d+)/i);

  if (customSize) {
    return {
      width: Number(customSize[1]),
      height: Number(customSize[2]),
    };
  }

  return { ...DEFAULT_CAR_IMAGE_SIZE };
}

function focusFromInstruction(instruction) {
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

export function resolveCarImageRule(recordId, instruction = '') {
  const fieldInstruction = String(instruction ?? '').trim();
  const text = fieldInstruction.startsWith('//')
    ? fieldInstruction
    : CAR_IMAGE_INSTRUCTIONS[recordId] ?? fieldInstruction;
  const override = CAR_IMAGE_OVERRIDES[recordId] ?? {};

  return {
    mode: override.mode ?? 'cover',
    target: override.target ?? targetFromInstruction(text),
    focus: override.focus ?? focusFromInstruction(text),
    instruction: text,
    hasInstruction: Boolean(CAR_IMAGE_INSTRUCTIONS[recordId]) || fieldInstruction.startsWith('//'),
    hasOverride: Boolean(CAR_IMAGE_OVERRIDES[recordId]),
  };
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

function outputSizeForSource(width, height, target) {
  const crop = cropForCover(width, height, target, { x: 0.5, y: 0.5 });
  const outputWidth = Math.min(target.width, crop.width);

  return {
    width: outputWidth,
    height: Math.round(outputWidth * (target.height / target.width)),
  };
}

async function renderContain(input, outputPath, rule) {
  const metadata = await sharp(input, { failOn: 'none' }).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read image dimensions');
  }

  const { target } = rule;
  const outputSize = outputSizeForSource(metadata.width, metadata.height, target);
  const scale = Math.min(outputSize.width / metadata.width, outputSize.height / metadata.height);
  const foregroundWidth = Math.round(metadata.width * scale);
  const foregroundHeight = Math.round(metadata.height * scale);
  const background = await sharp(input, { failOn: 'none' })
    .resize(outputSize.width, outputSize.height, { fit: 'cover', position: 'centre' })
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
        left: Math.round((outputSize.width - foregroundWidth) / 2),
        top: Math.round((outputSize.height - foregroundHeight) / 2),
      },
    ])
    .webp(CAR_IMAGE_ENCODING)
    .toFile(outputPath);

  return {
    width: outputSize.width,
    height: outputSize.height,
  };
}

async function renderCover(input, outputPath, rule) {
  const image = sharp(input, { failOn: 'none' });
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Could not read image dimensions');
  }

  const crop = cropForCover(metadata.width, metadata.height, rule.target, rule.focus);
  const outputWidth = Math.min(rule.target.width, crop.width);
  const outputHeight = Math.round(outputWidth * (rule.target.height / rule.target.width));

  await image
    .extract(crop)
    .resize(outputWidth, outputHeight, {
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: true,
    })
    .webp(CAR_IMAGE_ENCODING)
    .toFile(outputPath);

  return {
    width: outputWidth,
    height: outputHeight,
  };
}

export async function renderCarImage(input, outputPath, rule) {
  const dimensions =
    rule.mode === 'contain'
      ? await renderContain(input, outputPath, rule)
      : await renderCover(input, outputPath, rule);

  return {
    ...dimensions,
    mode: rule.mode,
    target: rule.target,
    focus: rule.focus,
  };
}
