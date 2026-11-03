// Hebrew — ride places: origin, destination and meeting points, picked only from official
// catalogs — a city (with an optional street) or a junction / interchange (spec 05 §5.3, D71).
export const ridePlaces = {
  fieldOrigin: 'מוצא',
  fieldDest: 'יעד',
  pickerTitle: 'בחירת מקום',
  pickerSearch: 'חיפוש עיר, צומת או מחלף',
  pickerEmpty: 'לא נמצא מקום בשם הזה',
  pickerError: 'לא הצלחנו לטעון את רשימת המקומות',
  streetOptional: 'רחוב (לא חובה)',
  meetingPointsTitle: 'נקודות איסוף בדרך (עד 3)',
  meetingPointLabel: 'נקודת איסוף {{n}}',
  addMeetingPoint: 'הוספת נקודת איסוף',
  removeMeetingPoint: 'הסרת נקודת האיסוף',
  // D72 — the ride detail: places in order, each with "navigate", and the route on a map.
  meetingPoint: 'נקודת איסוף',
  navigate: 'ניווט',
  navigateTo: 'ניווט אל {{place}}',
  navigationApp: { waze: 'Waze', google: 'Google Maps', apple: 'Apple Maps' },
  mapA11y: 'מפת המסלול של הנסיעה',
} as const;
