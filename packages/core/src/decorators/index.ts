// Metadata keys
export {
  EDM_TYPE_KEY,
  ODATA_EXCLUDE_KEY,
  ODATA_ENTITY_SET_KEY,
  ODATA_KEY_KEY,
  ODATA_VIEW_KEY,
  ODATA_ROUTE_KEY,
} from './metadata-keys.js'

// @EdmType decorator
export type { EdmTypeOptions } from './edm-type.decorator.js'
export { EdmType, getEdmTypeOverrides } from './edm-type.decorator.js'

// @ODataExclude decorator
export { ODataExclude, getExcludedProperties } from './odata-exclude.decorator.js'

// @ODataEntitySet decorator
export { ODataEntitySet, getEntitySetName } from './odata-entity-set.decorator.js'

// @ODataKey decorator
export { ODataKey, getKeyProperties } from './odata-key.decorator.js'

// @ODataView decorator
export type { ODataViewOptions } from './odata-view.decorator.js'
export { ODataView, getODataViewOptions } from './odata-view.decorator.js'

// @ODataGet route decorator
export type { ODataGetOptions } from './odata-get.decorator.js'
export { ODataGet } from './odata-get.decorator.js'

// @ODataQueryParam parameter decorator
export { ODataQueryParam } from './odata-query.decorator.js'
