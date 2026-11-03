// Build-time constants also let Vite remove unsupported feature dependencies.
export const IS_APP_BUILD = import.meta.env.APP_BUILD === true;
export const FILE_UPLOADS_ENABLED = !IS_APP_BUILD;
export const PDF_EXPORT_ENABLED = !IS_APP_BUILD;
