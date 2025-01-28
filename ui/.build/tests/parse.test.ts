import { describe, expect, test } from 'vitest';
import { compressWhitespace } from '../src/parse';

describe('minify', () => {
  test('string', () => {
    expect(compressWhitespace('a       b')).toBe('a b');
    expect(compressWhitespace('tab\ttab')).toBe('tab tab');
  });
  test('html', () => {
    const html = `
      <html>
      <head>
          <title>Test</title>
      </head>
      <body>
          <h1>Test</h1>
      </body>
      </html>
    `;
    const minified = compressWhitespace(html);
    expect(minified).toBe('<html> <head> <title>Test</title> </head> <body> <h1>Test</h1> </body> </html>');
  });
});
