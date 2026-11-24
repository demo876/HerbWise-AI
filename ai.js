
require('dotenv').config();

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

async function ask({ system = '', max_tokens = 4096, messages = [] }) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    const error = new Error(
      'AI is not configured. Add GEMINI_API_KEY to your .env file.'
    );
    error.status = 503;
    throw error;
  }

  const contents = messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [
      {
        text: Array.isArray(message.content)
          ? message.content.map(part => part.text || '').join('\n')
          : String(message.content || '')
      }
    ]
  }));

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: system }]
      },
      contents,
      generationConfig: {
        maxOutputTokens: max_tokens,
        temperature: 0.3,
        responseMimeType: 'application/json'
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const message =
      data?.error?.message || `Gemini API error: ${response.status}`;

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('\n');

  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  return text;
}

function json(text) {
  if (Array.isArray(text)) return text;

  let cleaned = String(text || '').trim();

  // Remove Markdown code fences if Gemini includes them.
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  // Parse the complete response first.
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // Try extracting a JSON array from surrounding text.
  }

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');

  if (start !== -1 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  throw new Error('Could not parse JSON returned by Gemini.');
}

module.exports = { ask, json };
