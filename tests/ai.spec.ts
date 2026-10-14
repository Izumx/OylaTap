import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
test('Ollama adapter sends a structured draft request and rejects invalid answers', async () => {
  let invalid = false;
  let received: any;
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      received = JSON.parse(data);
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              episodes: [
                {
                  title: 'Причины события',
                  script: 'Связь причин и последствий помогает понять историческое событие.',
                },
              ],
              questions: [
                {
                  prompt: 'Что помогает понять событие?',
                  options: ['Причины', 'Цвет'],
                  correct: invalid ? 4 : 0,
                  explanation: 'Причины помогают объяснить событие.',
                },
              ],
            }),
          },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const previous = { base: process.env.OLLAMA_BASE_URL, model: process.env.OLLAMA_MODEL };
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.OLLAMA_MODEL = 'contract-test';
  try {
    const { generateDraft } = await import('../server/ai');
    const input = {
      title: 'Исторические причины',
      source_text: 'Исходный текст о том, что связь причин и последствий помогает понять событие.',
      grade: 7,
      language: 'ru' as const,
    };
    const draft = await generateDraft(input);
    expect(draft.episodes).toHaveLength(1);
    expect(received.stream).toBe(false);
    expect(received.format.type).toBe('object');
    expect(JSON.parse(received.messages[1].content).source_text).toBe(input.source_text);
    invalid = true;
    await expect(generateDraft(input)).rejects.toThrow('некорректный вариант');
  } finally {
    if (previous.base === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = previous.base;
    if (previous.model === undefined) delete process.env.OLLAMA_MODEL;
    else process.env.OLLAMA_MODEL = previous.model;
    await new Promise<void>((r) => server.close(() => r()));
  }
});
