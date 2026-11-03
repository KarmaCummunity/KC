// ─────────────────────────────────────────────
// Brand identity — Karma Community (spec 17, D65)
// ─────────────────────────────────────────────
//
// The Hebrew name lives in the locale bundles (`appName`), not here, so
// user-facing copy stays in i18n. The mobile brand guard test checks that the
// store name and both locale bundles agree with these constants.

export const brand = {
  name: 'Karma Community',
  shortName: 'KC',
} as const;
