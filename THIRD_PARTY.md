# Third party

The map page bundles two fonts, both under the SIL Open Font License 1.1:

- Instrument Sans, via `@fontsource-variable/instrument-sans`
- IBM Plex Mono, via `@fontsource/ibm-plex-mono`

The page asks for Claude's own faces first, using the same font stacks claude.ai declares (Anthropic Sans and Anthropic Mono). Those are Anthropic's proprietary typefaces and are not shipped or linked here, so where the page can see them it uses them and otherwise falls back to the two open faces above.

The file layout engine is `elkjs` (EPL-2.0), and the parser is the TypeScript compiler API (Apache-2.0).
