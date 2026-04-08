# Phase 3: Query Engine and Response Format - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the discussion.

**Date:** 2026-04-07
**Phase:** 03-query-engine-and-response-format
**Mode:** discuss
**Areas discussed:** AST-to-QueryBuilder Translation, OData JSON Response Envelope, Error Handling and Validation, Controller and Routing Design

## Area: AST-to-QueryBuilder Translation

| Question                                                 | Answer                              | Options Presented                                       |
| -------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| How should the AST-to-TypeORM translation be structured? | Visitor per query option            | Visitor per option, Single monolithic, You decide       |
| How should $filter string functions map to SQL?          | TypeORM-native where possible       | TypeORM-native, All raw SQL, You decide                 |
| How should $select field projection work?                | QueryBuilder.select() at SQL level  | SQL projection, Fetch all strip in response, You decide |
| How should parameter binding work?                       | TypeORM's built-in parameterization | TypeORM built-in, Manual parameterized, You decide      |

## Area: OData JSON Response Envelope

| Question                                              | Answer                                                      | Options Presented                                  |
| ----------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| How should the OData JSON response be serialized?     | NestJS Interceptor                                          | Interceptor, Custom decorator+pipe, You decide     |
| How should @odata.nextLink pagination work?           | Offset-based with $skip/$top                                | Offset-based, Cursor-based, You decide             |
| How should @odata.context be constructed?             | serviceRoot + EntitySet + $select projection                | With projection, Simple EntitySet only, You decide |
| How should /$count vs $count=true behave?             | $count=true adds to envelope, /$count returns plain integer | Per spec, You decide                               |
| Should @odata.nextLink be present when no more pages? | Omit when no more pages                                     | Omit, Always include null, You decide              |

## Area: Error Handling and Validation

| Question                                         | Answer                                        | Options Presented                         |
| ------------------------------------------------ | --------------------------------------------- | ----------------------------------------- |
| How should OData errors be formatted?            | NestJS Exception Filter for OData routes      | Route filter, Global override, You decide |
| When should field validation against EDM happen? | At parse time with EDM context                | Parse time, Query build time, You decide  |
| How should parse errors be handled?              | Parser throws ODataParseError, filter catches | Per existing pattern, You decide          |

## Area: Controller and Routing Design

| Question                                              | Answer                                                  | Options Presented                                                      |
| ----------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| How should OData query endpoints be registered?       | User defines controllers, decorators add OData behavior | Auto-generated per EntitySet, Single dynamic, User-defined, You decide |
| How should query string parsing integrate?            | Custom ODataQueryPipe                                   | Pipe, Middleware, You decide                                           |
| Should /$count path segment be included?              | Yes                                                     | Yes, Defer                                                             |
| What does the consumer's controller code look like?   | Decorator on individual methods                         | Class-level decorator, Method-level decorator, You decide              |
| Should user implement handler or is it auto-provided? | Auto-provided with opt-in override                      | Auto with override, User implements, You decide                        |

## Corrections Made

No corrections — all recommended options were selected except for controller routing (user chose user-defined controllers over auto-generated).
