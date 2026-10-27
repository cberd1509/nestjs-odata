export type {
  ODataScope,
  ODataScopeContext,
  ODataScopeDefinition,
  ODataScopeFn,
  ODataScopeOperation,
  ScopedSubquery,
  TypeOrmScopePlan,
} from './scope.types.js'
export { ODataScopeRegistry } from './scope-registry.js'
export {
  TypeOrmScopeService,
  applyScopeToQuery,
  navigationTargetTypeName,
  scopeInCondition,
} from './typeorm-scope.service.js'
