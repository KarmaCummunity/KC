// Hebrew — ride places: origin, destination and meeting points, picked only from official
// catalogs — a city (with an optional street) or a junction / interchange (spec 05 §5.3, D71).
export const ridePlaces = {
  fieldOrigin: 'מוצא',
  fromCurrentLocation: 'מהמיקום הנוכחי',
  locationUnavailable: 'לא הצלחנו לקבל את המיקום. אפשר לבחור מוצא ידנית.',
  locating: 'מאתרים את המיקום…',
  originFromHere: 'מוצא: {{place}}',
  fieldDest: 'יעד',
  pickerTitle: 'בחירת מקום',
  pickerSearch: 'חיפוש עיר, צומת או מחלף',
  pickerEmpty: 'לא נמצא מקום בשם הזה',
  pickerError: 'לא הצלחנו לטעון את רשימת המקומות',
  streetOptional: 'רחוב (לא חובה)',
  houseNumberPlaceholder: 'מספר בית (לא חובה)',
  houseNumberPrivateHint: 'המספר לא מתפרסם — רק נוסעים שאישרת יראו אותו.',
  houseNumberPrivateNote: 'הכתובת המלאה גלויה רק לך ולנוסעים מאושרים.',
  houseNumberInvalid: 'מספר בית לא תקין — ספרות בלבד, אפשר עם אות (למשל 12 או 7א).',
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
