# UI Theme Requirements

When adding or changing UI, verify the `midnight` theme in addition to the default theme.

- Use the semantic theme variables in `src/index.css` for reusable surfaces and interaction states whenever possible.
- Do not introduce a light `bg-*` utility for selected, active, hover, disabled, or focus states unless its midnight-theme mapping is included in `src/index.css`.
- Check default, hover, selected, disabled, and keyboard-focus states for readable contrast before completing UI work.
