---
'@nestjs-odata/core': patch
---

`$filter` literals (#101):

- An unquoted GUID that starts with a digit (`id eq 12345678-1234-1234-1234-123456789abc`) parses anywhere in the expression; before, it only parsed at the very end of the filter, and failed with a 400 when anything followed it.
- Bare dates (`dueDate ge 2026-11-01`) and date-times with a time zone (`createdAt lt 2026-11-01T10:30:00Z`, `…-05:00`) parse. They become `Literal` nodes with `literalKind: 'date'` (new) or `'dateTimeOffset'`, and a string value. The lexer never produced them before, so they failed with a 400.
