import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f5ff',
          500: '#3b5bdb',
          600: '#364fc7',
          700: '#2f44b8',
        },
      },
    },
  },
  plugins: [],
};

export default config;
