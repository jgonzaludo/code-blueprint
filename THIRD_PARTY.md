# Third party

The map page bundles two fonts, both under the SIL Open Font License 1.1:

- Instrument Sans, via `@fontsource-variable/instrument-sans`
- IBM Plex Mono, via `@fontsource/ibm-plex-mono`

The page asks for Claude's own faces first (Anthropic Sans and Mono, which are proprietary and not shipped), so where those are available to the page it uses them and otherwise falls back to these.

The file layout engine is `elkjs` (EPL-2.0), and the parser is the TypeScript compiler API (Apache-2.0).
