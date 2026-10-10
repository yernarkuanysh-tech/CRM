import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {include: ['tests/web/pdf.test.ts']},
});
