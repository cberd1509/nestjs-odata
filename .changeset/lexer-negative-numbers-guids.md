---
'@nestjs-odata/core': patch
---

`$filter` (and every other expression parsed by the core lexer) now accepts negative numeric literals (`Price eq -5`, `Price gt -1.5`), which the ABNF allows (`[ SIGN ] 1*DIGIT`) and which previously answered 400 "Unexpected character '-'". GUID literals that start with a digit (`Id eq 01234567-89ab-cdef-0123-456789abcdef and ...`) are now recognised anywhere in the expression; before, they only parsed at the very end of the input.
