<!-- vowen:personal-preferences sha256=86346dd65f68a3c15f880893f924c60f7b1d99ed9153c73cfd6a25ac8ca92691 -->

# Repository engineering policies

- Keep production code in JavaScript MTS and use Node.js built-ins. Do not add Python tooling.
- Avoid dynamic `import()`. Use synchronous `require()` for conditional module loading, including inside control-flow blocks.
- Export behavior-bearing helpers so they can be tested directly.
- Mirror source paths under `test/`; keep each production module at or below 500 lines.
- Keep implementations DRY and simple. Prefer small focused modules and explicit platform boundaries.
- Pin development tools and use pnpm for repository commands. Keep runtime dependencies at zero unless a concrete need justifies one.
- Test process behavior, cleanup, platform fallbacks, malformed input, and failure paths. Do not infer Windows behavior from Unix results.
- Preserve signature verification and publisher checks for the optional Windows helper. A PE certificate header is only a hint; Windows Authenticode verification remains authoritative.

<!-- /vowen:personal-preferences -->

## Distribution and enforcement

- Bundle production MTS into readable `dist/*.mjs`; never minify published JavaScript.
- Run `pnpm run check` before pushing. `pnpm run setup` installs the tracked pre-push hook without replacing existing custom hooks.
- Keep platform-specific results explicit: macOS checks do not establish Linux or Windows compatibility.
