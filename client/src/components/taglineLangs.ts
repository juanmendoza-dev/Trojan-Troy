export interface TaglineLang {
  name: string;
  native: string;
  /** ISO-3166 country code, for flagcdn/bundled flag lookup. */
  flagCode: string;
  rtl: boolean;
  text: string;
}

// The home-screen tagline, translated for the rotation. English (index 0) is
// the anchor: it's also the aria-live fallback shown to assistive tech.
// AI-drafted / provisional — needs a native-speaker pass before ship.
export const TAGLINE_LANGS: TaglineLang[] = [
  { name: "English", native: "English", flagCode: "gb", rtl: false, text: "Give up privacy for safety, and you will lose both." },
  { name: "Spanish", native: "Español", flagCode: "es", rtl: false, text: "Renuncia a la privacidad por seguridad y perderás ambas." },
  { name: "French", native: "Français", flagCode: "fr", rtl: false, text: "Renoncez à la vie privée pour la sécurité, et vous perdrez les deux." },
  { name: "German", native: "Deutsch", flagCode: "de", rtl: false, text: "Gib die Privatsphäre für Sicherheit auf, und du verlierst beides." },
  { name: "Arabic", native: "العربية", flagCode: "sa", rtl: true, text: "تخلَّ عن الخصوصية مقابل الأمان، وستخسر كليهما." },
  { name: "Korean", native: "한국어", flagCode: "kr", rtl: false, text: "안전을 위해 사생활을 포기하면 둘 다 잃게 됩니다." },
  { name: "Russian", native: "Русский", flagCode: "ru", rtl: false, text: "Откажитесь от приватности ради безопасности — и потеряете и то, и другое." },
  { name: "Japanese", native: "日本語", flagCode: "jp", rtl: false, text: "安全のためにプライバシーを手放せば、その両方を失う。" },
  { name: "Chinese", native: "中文", flagCode: "cn", rtl: false, text: "为了安全放弃隐私，你将失去两者。" },
  { name: "Hindi", native: "हिन्दी", flagCode: "in", rtl: false, text: "सुरक्षा के लिए निजता छोड़ेंगे तो दोनों खो देंगे।" },
  { name: "Portuguese", native: "Português", flagCode: "pt", rtl: false, text: "Abra mão da privacidade pela segurança e perderá ambas." },
  { name: "Hebrew", native: "עברית", flagCode: "il", rtl: true, text: "ותרו על הפרטיות למען הביטחון — ותאבדו את שניהם." },
  { name: "Greek", native: "Ελληνικά", flagCode: "gr", rtl: false, text: "Θυσιάστε την ιδιωτικότητα για ασφάλεια, και θα χάσετε και τα δύο." },
];

export function nextTaglineIndex(index: number, length: number = TAGLINE_LANGS.length): number {
  return (index + 1) % length;
}
