import type { BotLanguage } from "./languages.js";

type GiftNameTable = Record<BotLanguage, string>;

const GIFT_NAMES: Record<string, GiftNameTable> = {
  "newspaper-from-date": {
    ru: "Оригинал газеты со дня рождения",
    en: "Original newspaper from birth date",
    lv: "Oriģināla avīze no dzimšanas dienas",
    et: "Originaalne ajaleht sünnikuupäevast",
    lt: "Originalus laikraštis nuo gimimo datos",
  },
  "life-book": {
    ru: "Книга жизни",
    en: "Book of life",
    lv: "Dzīves grāmata",
    et: "Eluraamat",
    lt: "Gyvenimo knyga",
  },
  "personal-newspaper": {
    ru: "Персональная газета о человеке",
    en: "Personal newspaper about someone",
    lv: "Personīga avīze par cilvēku",
    et: "Personaalne ajaleht inimesest",
    lt: "Personalizuotas laikraštis ap žmogų",
  },
  "glossy-magazine": {
    ru: "Именной глянцевый журнал",
    en: "Personalized glossy magazine",
    lv: "Personalizēts glancēts žurnāls",
    et: "Isikupärastatud ajakiri",
    lt: "Personalizuotas žurnalas",
  },
  "memory-book": {
    ru: "Книга воспоминаний",
    en: "Memory book",
    lv: "Atmiņu grāmata",
    et: "Mälestuste raamat",
    lt: "Atsiminimų knyga",
  },
  "discovery-passport": {
    ru: "Паспорт Открытий",
    en: "Passport of Discoveries",
    lv: "Atklājumu pase",
    et: "Avastuste pass",
    lt: "Atradimų pasas",
  },
  "joke-passport": {
    ru: "Паспорт Алкоголика (18+)",
    en: "Joke drinker's passport (18+)",
    lv: "Joka «alkoholiķa» pase (18+)",
    et: "Naljapass joogile (18+)",
    lt: "Juoko «alkoholiko» pasas (18+)",
  },
  "family-subscription": {
    ru: "Семейная газета по подписке",
    en: "Family newspaper subscription",
    lv: "Ģimenes avīze abonementā",
    et: "Perekonna ajalehe tellimus",
    lt: "Šeimos laikraštis prenumerata",
  },
};

export function giftName(externalId: string, lang: BotLanguage, fallback = ""): string {
  return GIFT_NAMES[externalId]?.[lang] ?? GIFT_NAMES[externalId]?.ru ?? fallback;
}
