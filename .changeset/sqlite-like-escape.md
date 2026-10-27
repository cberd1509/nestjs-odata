---
'@nestjs-odata/typeorm': patch
---

On SQLite, `contains()`, `startswith()`, `endswith()` and `$search` now match `%`, `_` and `\` literally. The value was escaped with backslashes, but SQLite has no default `LIKE` escape character, so `contains(name, '_')` matched nothing that contains an underscore, and matched any value containing a backslash followed by one character. The `LIKE` condition now carries `ESCAPE '\'` on SQLite-based drivers; PostgreSQL and MySQL, whose default escape character is already the backslash, are unchanged.
