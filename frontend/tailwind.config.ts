import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#FFFFFF",
        ink: "#000000",
        "ink-2": "#222222",
        muted: "#6B6B6B",
        pale: "#F2F2F2",
        border: "#D1D1D1",
        warm: "#D9D9D6",
        mta: "#0039A6",
        "mta-hover": "#002B7F",
        "mta-soft": "#E2EAF7",
        "link-hover": "#1883FD",
        ok: "#8DC572",
      },
      fontFamily: {
        sans: ['Archivo', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        none: "0",
      },
    },
  },
  plugins: [],
};

export default config;
