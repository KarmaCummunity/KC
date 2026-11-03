// Re-export: the reading-start / reading-end text edges live in `rtlLayout.ts`, the one RTL
// helper module (issue #1289). Existing importers keep this path; new code imports `rtlLayout`.
export { rtlTextAlignEnd, rtlTextAlignStart } from './rtlLayout';
