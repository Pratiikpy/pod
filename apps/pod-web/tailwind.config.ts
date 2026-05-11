import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ink: '#0a0a0a',
        paper: '#fafafa',
        accent: '#10b981',
        warn: '#f59e0b',
        danger: '#ef4444',
      },
    },
  },
} satisfies Config;
