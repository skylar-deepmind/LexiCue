# Start Here

- Read the product rules below and [the current handoff](docs/progress.md) before choosing a baseline or resuming work. Use the linked PRs, source and verification results to check what applies to your revision.
- Start new work on a development branch from synchronized `main`. Resume on the existing task branch. Check the worktree and index before switching or editing, and preserve other work and local files.
- Follow [development checks](docs/development-testing.md) and choose checks for the affected behavior. For changes involving dictionary data or packaging, also read [dictionary policy and maintenance](docs/dictionary/README.md). For distribution, use [release validation](docs/release-validation-policy.md) and [installation and distribution](DISTRIBUTION.md).
- In the primary checkout, read the local `docs/ai-workflow.md` when present for the development board, device installation, rollback and publishing procedures. Verify the PR and its target before merging with explicit approval. Verify the synchronized target before any post-merge installation. Obtain separate approval for branch deletion and public releases.
- Record acceptance criteria and detailed results in the task's existing PR or verification document. Update the relevant product or implementation document when a decision changes and link its source. Update [the handoff](docs/progress.md) when the active scope, next action, or latest verified baseline changes. Include the date, commit, platform, check and evidence location. Keep raw device receipts, signing materials and private data local.

# UI Theme Requirements

When adding or changing UI, verify the `midnight` theme in addition to the default theme.

- Use the semantic theme variables in `src/index.css` for reusable surfaces and interaction states whenever possible.
- Do not introduce a light `bg-*` utility for selected, active, hover, disabled, or focus states unless its midnight-theme mapping is included in `src/index.css`.
- Check default, hover, selected, disabled, and keyboard-focus states for readable contrast before completing UI work.

# Product Scope and Minimalist Design

- The current product targets English learning only. Do not expand learning-language support or add language-selection flows by default. Chinese remains available for the interface and explanations.
- Apply minimalism to all future feature design and UI/UX work, not only the first release. The core flow is: import material → understand on demand → save with context → recall on re-encounter.
- Add a feature only when it directly improves that flow or supports reliability, data protection, or accessibility. First consider removing, combining, or resolving it through sensible defaults.
- Give each screen one clear primary action. Keep one clear entry for each task, reveal secondary controls when needed, and minimize configuration, form filling, and navigation.
- Prefer concise copy, consistent components, readable contrast, and useful whitespace over decoration. Minimalism must not remove necessary feedback, undo, or keyboard access.
- Review both user benefit and added complexity before accepting new features or UI. Do not add scope whose benefit is unclear.
- When retiring non-English learning support, preserve existing records for backup, viewing, and export; do not silently delete them or keep them active in the new learning flow.
