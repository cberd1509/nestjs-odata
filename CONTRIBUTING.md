# Contributing to nestjs-odata

## Development Setup

```bash
git clone https://github.com/cberd1509/nestjs-odata.git
cd nestjs-odata
pnpm install
pnpm build
pnpm test
```

## Project Structure

```
packages/core/        — OData parser, decorators, EDM, module system (ORM-agnostic)
packages/typeorm/     — TypeORM adapter: EDM derivation, query translation, CRUD
packages/eslint-config/ — Shared ESLint flat config
apps/test-app/        — Integration test suite (NestJS app with real HTTP tests)
```

## Running Tests

```bash
# All tests
pnpm test

# Single package
pnpm --filter @nestjs-odata/core test
pnpm --filter @nestjs-odata/typeorm test

# Integration tests (test-app)
pnpm --filter @nestjs-odata/test-app test

# Watch mode
pnpm --filter @nestjs-odata/test-app test:watch

# With coverage (80% threshold enforced)
pnpm test -- --coverage
```

## Local Development

After making changes to `packages/core` or `packages/typeorm`:

```bash
# Rebuild (required before test-app picks up changes)
pnpm build

# Run integration tests to validate
pnpm --filter @nestjs-odata/test-app test
```

Linting and formatting run automatically via pre-commit hooks (Husky + lint-staged). You can also run them manually:

```bash
pnpm lint        # ESLint
pnpm typecheck   # TypeScript type checking
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
