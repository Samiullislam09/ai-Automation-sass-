# Self-hosted fonts

These are the Latin subsets of five open-source fonts, served from our own domain through `next/font/local`.
They used to come from `next/font/google`, which downloads from fonts.googleapis.com **during `next build`**; when Google
answered with a font URL Next 14.2 could not parse, the whole deployment failed ("Cannot read properties of null (reading '1')").
Files in the repo cannot fail that way.

| File | Font | Used for |
|---|---|---|
| `inter-latin-wght-normal.woff2` | Inter (variable, 100-900) | dashboard (`app/dashboard/layout.tsx`) |
| `manrope-latin-wght-normal.woff2` | Manrope (variable, 200-800) | body text (`app/layout.tsx`) |
| `plus-jakarta-sans-latin-wght-normal.woff2` | Plus Jakarta Sans (variable, 200-800) | headings (`app/layout.tsx`) |
| `bricolage-grotesque-latin-800-normal.woff2` | Bricolage Grotesque 800 | landing headings (`components/landing-v2/fonts.ts`) |
| `jetbrains-mono-latin-500-normal.woff2` | JetBrains Mono 500 | landing labels (`components/landing-v2/fonts.ts`) |

Source: the `@fontsource` / `@fontsource-variable` npm packages (files copied as published). All five are licensed under the
SIL Open Font License 1.1 (https://openfontlicense.org), which allows redistribution with the fonts' own copyright notices;
those are in each package and in the upstream repositories linked from https://fontsource.org.
