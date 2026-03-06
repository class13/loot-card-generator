import type {
  CardPromptGenerator,
  GeneratedCardPrompts,
  LootCard,
} from './card-prompt-generator.js';

const ALLOWED_CATEGORIES = new Set([
  'weapon',
  'armor',
  'clothing',
  'jewelry',
  'potion',
  'scroll',
  'book',
  'tool',
  'container',
  'artifact',
  'other',
]);

type OllamaResponse = {
  response?: string;
};

type OllamaGeneratePayload = {
  model: string;
  system: string;
  prompt: string;
  stream: false;
  options: {
    temperature: number;
    top_p: number;
    num_predict: number;
  };
};

type OllamaModelOutput = {
  category?: string;
  prompt?: string;
  positive_prompt?: string;
  negative_prompt?: string;
};

type FetchImpl = typeof fetch;

type OllamaCardPromptGeneratorOptions = {
  ollamaUrl: string;
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  fetchImpl?: FetchImpl;
};

function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitPromptFragments(value: unknown): string[] {
  const text = cleanText(value)
    .replace(/<lora:[^>]+>/gi, '')
    // Preserve decimal numbers (e.g. 1.3) while splitting on sentence dots.
    .replace(/(\d)\.(\d)/g, '$1__DECIMAL_DOT__$2');

  return text
    .split(/[.\n,;]+/)
    .map((part) => cleanText(part))
    .map((part) => part.replace(/__DECIMAL_DOT__/g, '.'))
    .filter(Boolean);
}

function normalizePositivePrompt(value: unknown): string {
  const fragments = splitPromptFragments(value).filter((part) => !/^2d icon$/i.test(part));
  const parts = ['2d icon', ...fragments];
  if (!parts.some((part) => /^<lora:game_icon_v1\.0:1>$/i.test(part))) {
    parts.push('<lora:game_icon_v1.0:1>');
  }
  return parts.join('. ');
}

function normalizeNegativePrompt(value: unknown): string {
  const rawParts = splitPromptFragments(value).map((part) => {
    if (/^\(blurry:1\.3\)$/i.test(part) || /^blurry$/i.test(part)) return '(blurry:1.3)';
    if (/^low ?res$/i.test(part)) return 'lowres';
    return part;
  });

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const part of ['(blurry:1.3)', 'lowres', ...rawParts]) {
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(part);
    }
  }
  return deduped.join('. ');
}

function extractJsonObject(text: string): OllamaModelOutput {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as OllamaModelOutput;
  } catch {
    // fall through
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model response did not include a JSON object.');
  }

  const candidate = trimmed.slice(start, end + 1);
  return JSON.parse(candidate) as OllamaModelOutput;
}

function buildSystemPrompt(): string {
  return [
    'You are a prompt compiler for Stable Diffusion XL.',
    'Your job is to convert a Dungeons & Dragons item into short SD prompt fields for a single isolated item icon.',
    'STRICT RULES:',
    '1. Always assume the image should show a SINGLE object.',
    '2. Keep prompts compact, fragment-based, and period-separated.',
    '3. Do NOT describe full scenes or environments.',
    '4. Do NOT include characters unless the item absolutely requires it.',
    '5. Avoid cinematic language and storytelling.',
    '6. Focus on concrete visual traits only.',
    'You MUST output valid JSON in this exact format:',
    '{"category":"...","prompt":"...","negative_prompt":"..."}',
    'CATEGORY RULES:',
    'Classify the item into one of these only: weapon, armor, clothing, jewelry, potion, scroll, book, tool, container, artifact, other.',
    'PROMPT FORMAT:',
    'Use this style exactly: "2d icon. [short visual fragments]. <lora:game_icon_v1.0:1>"',
    'Use 2-8 concise fragments after "2d icon".',
    'Example style: "2d icon. dead frog. brown. dried. <lora:game_icon_v1.0:1>"',
    'NEGATIVE_PROMPT FORMAT:',
    'Always start with: "(blurry:1.3). lowres."',
    'Then optionally append short exclusions as period-separated fragments (for example: "armor. character").',
    'Keep it compact and practical.',
    'Do not output anything except valid JSON.',
  ].join('\n');
}

function getOptionalString(card: LootCard, key: string): string {
  const value = card[key];
  return typeof value === 'string' ? value : '';
}

function getOptionalStringArray(card: LootCard, key: string): string[] {
  const value = card[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function buildUserPrompt(card: LootCard): string {
  const parts = [
    `name: ${cleanText(getOptionalString(card, 'name'))}`,
    `rarity: ${cleanText(getOptionalString(card, 'rarity'))}`,
  ];

  const type = getOptionalString(card, 'type');
  const tags = getOptionalStringArray(card, 'tags');
  const description = getOptionalString(card, 'description');
  const flavor = getOptionalString(card, 'flavor');

  if (type) parts.push(`type: ${cleanText(type)}`);
  if (tags.length) parts.push(`tags: ${tags.map(cleanText).join(', ')}`);
  if (description) parts.push(`description: ${cleanText(description)}`);
  if (flavor) parts.push(`flavor: ${cleanText(flavor)}`);

  return [
    'Create prompt fields for this fantasy loot item.',
    'Use compact dot-separated prompt fragments.',
    'No artist names.',
    'Output JSON only.',
    parts.join('\n'),
  ].join('\n\n');
}

async function fetchJson(url: string, init: RequestInit, fetchImpl: FetchImpl): Promise<OllamaResponse> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach Ollama at ${url}: ${message}`);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }

  return res.json() as Promise<OllamaResponse>;
}

export class OllamaCardPromptGenerator implements CardPromptGenerator {
  private readonly ollamaUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly topP: number;
  private readonly maxTokens: number;
  private readonly fetchImpl: FetchImpl;

  constructor(opts: OllamaCardPromptGeneratorOptions) {
    this.ollamaUrl = opts.ollamaUrl;
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.topP = opts.topP;
    this.maxTokens = opts.maxTokens;
    this.fetchImpl = opts.fetchImpl || fetch;
  }

  async generateForCard(card: LootCard): Promise<GeneratedCardPrompts> {
    const payload: OllamaGeneratePayload = {
      model: this.model,
      system: buildSystemPrompt(),
      prompt: buildUserPrompt(card),
      stream: false,
      options: {
        temperature: this.temperature,
        top_p: this.topP,
        num_predict: this.maxTokens,
      },
    };

    const data = await fetchJson(
      `${this.ollamaUrl}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      this.fetchImpl,
    );

    const responseText = cleanText(data.response || '');
    if (!responseText) {
      throw new Error('Ollama returned an empty response.');
    }

    let parsed: OllamaModelOutput;
    try {
      parsed = extractJsonObject(responseText);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not parse model output as JSON: ${message}. Raw: ${responseText.slice(0, 250)}`);
    }

    const prompt = normalizePositivePrompt(parsed.prompt || parsed.positive_prompt);
    const negativePrompt = normalizeNegativePrompt(parsed.negative_prompt);
    const category = cleanText(parsed.category).toLowerCase();

    if (!prompt || !negativePrompt) {
      throw new Error(`Model JSON missing required fields. Raw: ${responseText.slice(0, 250)}`);
    }
    if (!ALLOWED_CATEGORIES.has(category)) {
      throw new Error(`Model JSON has invalid or missing category. Raw: ${responseText.slice(0, 250)}`);
    }

    return { category, prompt, negativePrompt };
  }
}
