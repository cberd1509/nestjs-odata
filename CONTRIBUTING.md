# Contributing to nestjs-odata

## Development Setup

```bash
git clone https://github.com/your-org/nestjs-odata.git
cd nestjs-odata
pnpm install
pnpm build
pnpm test
```

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation
- `test:` — Tests
- `chore:` — Maintenance
- `refactor:` — Code refactoring

## Pull Requests

1. Fork and create a feature branch
2. Make your changes with tests
3. Run `pnpm lint && pnpm test && pnpm build`
4. Add a changeset: `pnpm changeset`
5. Open a PR against `main`

## Adding a Changeset

If your change affects published packages, add a changeset:

```bash
pnpm changeset
```

Select the affected packages, bump type (major/minor/patch), and describe the change.
