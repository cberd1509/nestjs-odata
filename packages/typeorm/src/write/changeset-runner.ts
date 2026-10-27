/**
 * DI token of the application's {@link ODataChangesetRunner}. Set it with
 * `ODataTypeOrmModule.forRoot({ changesetRunner })`, or provide it yourself from a `@Global()`
 * module when the runner needs injected services.
 */
export const ODATA_CHANGESET_RUNNER = Symbol('ODATA_CHANGESET_RUNNER')
