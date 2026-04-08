---
layout: home
hero:
  name: nestjs-odata
  text: OData v4 for NestJS
  tagline: Define entities once in TypeORM, get spec-compliant OData v4 automatically
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /api/
features:
  - title: What is OData?
    details: OData (Open Data Protocol) is a standardized REST protocol for queryable APIs, backed by OASIS and used by Microsoft, SAP, and enterprise clients. It defines conventions for filtering, sorting, pagination, and metadata — so clients and servers speak the same language.
  - title: Zero Double-Declaration
    details: Auto-derive EDM from TypeORM entities. No manual OData schema maintenance.
  - title: Spec Compliant
    details: Built from the OASIS OData v4 ABNF grammar. Responses pass OData validation.
  - title: NestJS Native
    details: Works with NestJS decorators, guards, pipes, and interceptors. Mix OData and REST routes freely.
  - title: Rich Filter Support
    details: Lambda any/all, arithmetic operators, date/time functions, string functions — all translated to parameterized SQL.
  - title: $batch Support
    details: Multi-operation batch requests with atomic changesets. Zero additional setup when using ODataTypeOrmModule.
  - title: Security Built-In
    details: maxTop, maxExpandDepth, maxFilterDepth limits enforced server-side. Parameterized queries prevent SQL injection.
---
