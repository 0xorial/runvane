# Frontend Styling Rules

- Default to component-local styles in `*.module.css`.
- Keep global CSS in `frontend/src/styles.css` minimal:
  - design tokens (`--*`)
  - primitives (`.btn`, `.input`, `.card`)
  - tiny text utilities (`.mono`, `.small`)
- Build UI variants in module files by composing primitives:
  - `className={"btn " + styles.someButton}`
  - `className={"input " + styles.someInput}`
- Do not add feature-specific global selectors.
- Prefer tokens over hardcoded sizes/colors when possible:
  - spacing: `--space-1..4`
  - radii: `--radius-sm|md|lg`
