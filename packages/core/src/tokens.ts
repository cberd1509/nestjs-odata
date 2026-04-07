/**
 * DI injection token for the array of EdmEntityConfig objects
 * registered via ODataModule.forFeature().
 */
export const EDM_ENTITY_CONFIGS = Symbol('EDM_ENTITY_CONFIGS')

/**
 * DI injection token for the fully-resolved ODataModuleOptions (with defaults applied).
 * Defined here (not in odata.module.ts) to avoid circular imports with metadata builders.
 */
export const ODATA_MODULE_OPTIONS = Symbol('ODATA_MODULE_OPTIONS')
