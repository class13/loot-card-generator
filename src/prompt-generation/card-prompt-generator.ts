export type LootCard = Record<string, unknown>;

export interface GeneratedCardPrompts {
  prompt: string;
}

export interface CardPromptGenerator {
  generateForCard(card: LootCard): Promise<GeneratedCardPrompts>;
}

export function assertCardPromptGenerator(generator: unknown): CardPromptGenerator {
  if (!generator || typeof generator !== 'object' || typeof (generator as { generateForCard?: unknown }).generateForCard !== 'function') {
    throw new Error('Invalid card prompt generator: missing generateForCard(card) method.');
  }

  return generator as CardPromptGenerator;
}
