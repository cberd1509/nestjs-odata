/** Metadata key for @EdmType() property decorator — stores EdmTypeOptions per property */
export const EDM_TYPE_KEY = Symbol('nestjs-odata:edm-type')

/** Metadata key for @ODataExclude() property decorator — stores Set<string> of excluded property names */
export const ODATA_EXCLUDE_KEY = Symbol('nestjs-odata:odata-exclude')

/** Metadata key for @ODataEntitySet() class decorator — stores the entity set name string */
export const ODATA_ENTITY_SET_KEY = Symbol('nestjs-odata:entity-set')

/** Metadata key for @ODataKey() property decorator — stores string[] of key property names */
export const ODATA_KEY_KEY = Symbol('nestjs-odata:odata-key')

/** Metadata key for @ODataView() class decorator — stores ODataViewOptions */
export const ODATA_VIEW_KEY = Symbol('nestjs-odata:odata-view')

/** Metadata key for @ODataGet() method decorator — marks a route as an OData route */
export const ODATA_ROUTE_KEY = Symbol('ODATA_ROUTE')

/** Metadata key for @ODataController() class decorator — stores the entity set name string */
export const ODATA_CONTROLLER_KEY = Symbol('nestjs-odata:odata-controller')

/** Metadata key for @ODataETag() property decorator — stores the ETag source property name */
export const ODATA_ETAG_KEY = Symbol('nestjs-odata:odata-etag')
