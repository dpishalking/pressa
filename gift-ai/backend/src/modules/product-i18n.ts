import type { BotLanguage } from "./languages.js";

export type CatalogCardContent = {
  name: string;
  what: string;
  idea: string;
  audience?: string;
  story?: string;
};

const LABELS: Record<
  BotLanguage,
  { what: string; idea: string; audience: string; story: string }
> = {
  ru: {
    what: "Что вы получите",
    idea: "Главная идея",
    audience: "Кому подходит",
    story: "Как бывает на практике",
  },
  en: {
    what: "What you get",
    idea: "Main idea",
    audience: "Who it's for",
    story: "How it works in practice",
  },
  lv: {
    what: "Ko jūs saņemsiet",
    idea: "Galvenā ideja",
    audience: "Kam piemērots",
    story: "Kā tas notiek praksē",
  },
  et: {
    what: "Mida sa saad",
    idea: "Peamine idee",
    audience: "Kellele sobib",
    story: "Kuidas see praktikas on",
  },
  lt: {
    what: "Ką gausite",
    idea: "Pagrindinė idėja",
    audience: "Kam tinka",
    story: "Kaip būna praktikoje",
  },
};

export const PRICE_ON_REQUEST: Record<BotLanguage, string> = {
  ru: "по запросу",
  en: "on request",
  lv: "pēc pieprasījuma",
  et: "hind päringu järgi",
  lt: "pagal užklausą",
};

function block(label: string, body?: string): string | null {
  const text = body?.trim();
  if (!text) return null;
  return `${label}: ${text}`;
}

export function assembleLocalizedCard(content: CatalogCardContent, lang: BotLanguage): string {
  const L = LABELS[lang];
  return [
    block(L.what, content.what),
    block(L.idea, content.idea),
    block(L.audience, content.audience),
    block(L.story, content.story),
  ]
    .filter(Boolean)
    .join("\n\n");
}

const CARDS: Record<string, Partial<Record<BotLanguage, CatalogCardContent>>> = {
  "newspaper-from-date": {
    en: {
      name: "Original newspaper from birth date",
      what: "A real newspaper or magazine from the exact day and year that matters — a piece of the past in a Retro Pressa folder.",
      idea: "Take them back to their day: headlines, prices, and news from that era. Better than any toast at the table.",
      audience: "Mom, dad, grandparents, a boss, colleague — anyone with a date worth celebrating.",
      story: "A son gave his father a paper from his 1978 birthday — he kept leafing through it all evening.",
    },
    lv: {
      name: "Oriģināla avīze no dzimšanas dienas",
      what: "Īsta avīze vai žurnāls no tās īsās dienas un gada — īsts pagātnes fragments Retro Pressa mapē.",
      idea: "Atgriezt cilvēku viņa dienā — ar virsrakstiem, cenām un jaunumiem no tā laika.",
      audience: "Mammai, tētim, vecvecākiem, vadītājam, kolēģim.",
      story: "Dēls uzdāvināja tēvam avīzi no 1978. gada dzimšanas dienas — tēvs ilgi to lasīja.",
    },
    et: {
      name: "Originaalne ajaleht sünnikuupäevast",
      what: "Päris ajaleht või ajakiri täpselt sellest päevast ja aastast — mineviku killuke Retro Pressa kaustas.",
      idea: "Viia inimene tagasi tema päeva — pealkirjad, hinnad ja uudised tollest ajast.",
      audience: "Emale, isale, vanavanematele, juhile, kolleegile.",
      story: "Poeg kinkis isale ajalehe 1978. aasta sünnipäevast — isa lehitses seda kaua.",
    },
    lt: {
      name: "Originalus laikraštis nuo gimimo datos",
      what: "Tikras laikraštis ar žurnalas iš tos pačios dienos ir metų — praeities fragmentas Retro Pressa aplankale.",
      idea: "Grąžinti žmogų į jo dieną — su antraštėmis, kainomis ir naujienomis iš to laiko.",
      audience: "Mamai, tėčiui, seneliams, vadovui, kolegai.",
      story: "Sūnus padovanojo tėčiui laikraštį iš 1978 m. gimtadienio — tėvas ilgai jį vartė.",
    },
  },
  "life-book": {
    en: {
      name: "Book of life",
      what: "A thick gift book where each year of someone's life unfolds through headlines and the spirit of the era.",
      idea: "Show not one day, but a whole life — through the press that accompanied every chapter.",
      audience: "Dad, mom, grandparents, spouse, milestone birthdays — when you need something meaningful.",
      story: "For a father's 70th, the family made a book of 80 years in headlines — everyone read it aloud.",
    },
    lv: {
      name: "Dzīves grāmata",
      what: "Bieza dāvanu grāmata, kur katrs dzīves gads atklājas caur virsrakstiem un laika garu.",
      idea: "Parādīt ne vienu dienu, bet visu dzīvi — caur presi, kas pavadīja katru posmu.",
      audience: "Tētim, mammai, vecvecākiem, laulātajam — kad vajag ko nopietnu.",
      story: "Tēva 70. gadeiēti bērni salika grāmatu «80 gadi caur presi» — lasīja visi kopā.",
    },
    et: {
      name: "Eluraamat",
      what: "Paks kingiraamat, kus iga eluaasta avaneb pealkirjade ja ajastu vaimu kaudu.",
      idea: "Näidata mitte ühte päeva, vaid kogu elu — ajakirjanduse kaudu.",
      audience: "Isale, emale, vanavanematele, abikaasale — kui vaja midagi tõsist.",
      story: "Isa 70. juubeliks tegid lapsed raamatu «80 aastat pealkirjades» — lugesid kõik koos.",
    },
    lt: {
      name: "Gyvenimo knyga",
      what: "Stora dovanų knyga, kur kiekvieni metai atsiskleidžia per antraštes ir epochos dvasią.",
      idea: "Parodyti ne vieną dieną, o visą gyvenimą — per spaudą, lydėjusią kiekvieną etapą.",
      audience: "Tėčiui, mamai, seneliams, sutuoktiniui — kai reikia prasmingo.",
      story: "Tėčio 70-mečiui vaikai sudarė knygą «80 metų antraštėse» — skaitė visi kartu.",
    },
  },
  "personal-newspaper": {
    en: {
      name: "Personal newspaper about someone",
      what: "A newspaper where your loved one is the hero — their photo on page one, headlines, stories, and wishes.",
      idea: "Make someone the news — beautifully and ceremonially. All eyes on them.",
      audience: "Mom, dad, spouse, friend, colleague — when you have photos and stories to weave in.",
      story: "A daughter made a paper for her dancer mom — competition photo on the cover, butterflies inside.",
    },
    lv: {
      name: "Personīga avīze par cilvēku",
      what: "Avīze, kur galvenais varonis ir jūsu tuvs cilvēks — foto pirmajā lappusē, virsraksti un apsveikumi.",
      idea: "Padarīt cilvēku par ziņu — skaisti un svinīgi. Visa uzmanība uz viņu.",
      audience: "Mammai, tētim, laulātajam, draugam, kolēģim.",
      story: "Meita uztaisīja avīzi mammai dejotājai — konkursa foto uz vāka.",
    },
    et: {
      name: "Personaalne ajaleht inimesest",
      what: "Ajaleht, kus peategelane on teie lähedane — foto esikaanel, pealkirjad ja soovid.",
      idea: "Teha inimene uudiseks — ilusalt ja pidulikult. Kogu tähelepanu temal.",
      audience: "Emale, isale, abikaasale, sõbrale, kolleegile.",
      story: "Tütar tegi emale tantsija ajalehe — võistluse foto kaanel.",
    },
    lt: {
      name: "Personalizuotas laikraštis ap žmogų",
      what: "Laikraštis, kuriame pagrindinis herojus — jūsų artimas žmogus: foto pirmame puslapyje, antraštės ir palinkėjimai.",
      idea: "Padaryti žmogų naujienomis — gražiai ir iškilmingai. Visas dėmesys jam.",
      audience: "Mamai, tėčiui, sutuoktiniui, draugui, kolegai.",
      story: "Dukra padarė laikraštį mamai šokėjai — konkurso foto viršelyje.",
    },
  },
  "glossy-magazine": {
    en: {
      name: "Personalized glossy magazine",
      what: "A full glossy magazine about one person — cover, interview, photos, quotes, and wishes like a real edition.",
      idea: "Turn someone into the hero of their own glossy — a story you want to read aloud at the table.",
      audience: "Milestone birthdays, bosses, partners, parents — when status and beauty matter.",
      story: "For his wife's 50th, a husband ordered a «life story» style magazine — guests thought it was from a kiosk.",
    },
    lv: {
      name: "Personalizēts glancēts žurnāls",
      what: "Pilnvērtīgs glancēts žurnāls par vienu cilvēku — vāks, intervija, foto un apsveikumi kā īstā izdevumā.",
      idea: "Pārvērst tuvu cilvēku par savas žurnāla varoņu — stāstu, ko gribas lasīt skaļi pie galda.",
      audience: "Jubilāram, vadītājam, partnerim, vecākiem — kad vajag premium efektu.",
      story: "Sievas 50. gadei vīrs pasūtīja žurnālu «dzīves stāsta» stilā — viesi domāja, ka no kioska.",
    },
    et: {
      name: "Isikupärastatud ajakiri",
      what: "Täisväärtuslik ajakiri ühe inimese kohta — kaas, intervjuu, fotod ja soovid nagu päris väljaandes.",
      idea: "Muuta lähedane oma ajakirja kangelaseks — lugu, mida tahad laua taga ette lugeda.",
      audience: "Juubilarile, juhile, partnerile, vanematele — kui vaja premium efekti.",
      story: "Naise 50. juubeliks tellis abikaasa «elu loo» stiilis ajakirja — külalised arvasid, et poest.",
    },
    lt: {
      name: "Personalizuotas žurnalas",
      what: "Pilnas blizgantis žurnalas apie vieną žmogų — viršelis, interviu, foto ir palinkėjimai kaip tikrame leidinyje.",
      idea: "Paverti artimą savo žurnalo herojumi — istorija, kurią norisi skaityti prie stalo.",
      audience: "Jubiliatui, vadovui, partneriui, tėvams — kai reikia premium efekto.",
      story: "Žmonos 50-mečiui vyras užsakė «gyvenimo istorijos» stiliaus žurnalą — svečiai manė, kad iš kiosko.",
    },
  },
  "memory-book": {
    en: {
      name: "Memory book",
      what: "A hardcover book with family photos, stories, words from loved ones, and important dates.",
      idea: "Save what usually stays in phones and spoken tales — while you still can.",
      audience: "Grandma, grandpa, parents, the whole family — for milestones or «while we're still here».",
      story: "Grandchildren made a book for grandma's 80th — old photos, recipes, and war stories inside.",
    },
    lv: {
      name: "Atmiņu grāmata",
      what: "Grāmata cietajā vākos ar ģimenes foto, stāstiem, tuvinieku vārdiem un svarīgiem datumiem.",
      idea: "Saglabāt to, kas parasti paliek telefonos un stāstos — kamēr vēl var ierakstīt.",
      audience: "Vecvecākiem, vecākiem, visai ģimenei — jubilejā vai vienkārši «kamēr esam kopā».",
      story: "Mazbērni salika grāmatu vecmāmiņas 80. gadei — vecas fotogrāfijas un receptes iekšā.",
    },
    et: {
      name: "Mälestuste raamat",
      what: "Kõvakaaneline raamat perefoto, lugude, lähedaste sõnade ja oluliste kuupäevadega.",
      idea: "Säilitada see, mis tavaliselt jääb telefonidesse — kuni veel saab kirja panna.",
      audience: "Vanaemale, vanaisale, vanematele, perele — juubeliks või «kuni oleme koos».",
      story: "Lapselapsed tegid vanaema 80. juubeliks raamatu — vanad fotod ja retseptid sees.",
    },
    lt: {
      name: "Atsiminimų knyga",
      what: "Knyga kietu viršeliu su šeimos foto, istorijomis, artimųjų žodžiais ir svarbiomis datomis.",
      idea: "Išsaugoti tai, kas paprastai lieka telefonuose — kol dar galima užrašyti.",
      audience: "Močiutei, seneliui, tėvams, šeimai — jubiliejaus proga ar tiesiog «kol esame kartu».",
      story: "Anūkai sudarė knygą močiutės 80-mečiui — senos nuotraukos ir receptai viduje.",
    },
  },
  "discovery-passport": {
    en: {
      name: "Passport of Discoveries",
      what: "A real passport with a personal route, missions, and stamps — a gift-adventure you want to live.",
      idea: "Give not a souvenir, but an experience — movement, discoveries, shared moments.",
      audience: "Couples, friends, families with kids — birthdays, anniversaries, or a new chapter.",
      story: "A wife gave her husband a passport before Rome — a new mission and visa stamp every day.",
    },
    lv: {
      name: "Atklājumu pase",
      what: "Īsta pase ar personīgu maršrutu, uzdevumiem un zīmogiem — dāvana-piedzīvojums.",
      idea: "Dāvināt ne suvenīru, bet pieredzi — kustību, atklājumus, kopīgus mirkļus.",
      audience: "Pārim, draugam, ģimenei ar bērniem — dzimšanas dienā vai gadadienā.",
      story: "Sieva uzdāvināja vīram pasi pirms Romas — katru dienu jauns uzdevums un zīmogs.",
    },
    et: {
      name: "Avastuste pass",
      what: "Päris pass isikliku marsruudi, ülesannete ja templitega — kingitus-seiklus.",
      idea: "Kinkida mitte suveniiri, vaid elamust — liikumist, avastusi, ühiseid hetki.",
      audience: "Paarile, sõbrale, peredele lastega — sünnipäevaks või aastapäevaks.",
      story: "Naine kinkis abimehele passi enne Roomat — iga päev uus ülesanne ja tempel.",
    },
    lt: {
      name: "Atradimų pasas",
      what: "Tikras pasas su asmeniniu maršrutu, užduotimis ir antspaudais — dovana-nuotykis.",
      idea: "Dovanoti ne suvenyrą, o patirtį — judėjimą, atradimus, bendras akimirkas.",
      audience: "Porai, draugui, šeimoms su vaikais — gimtadieniui ar metinėms.",
      story: "Žmona padovanojo vyrui pasą prieš Romą — kiekvieną dieną nauja užduotis ir antspaudas.",
    },
  },
  "joke-passport": {
    en: {
      name: "Joke drinker's passport (18+)",
      what: "A funny personal passport with photo, «visas», and evening missions — looks real, plays as a joke.",
      idea: "Give not an object, but the mood of the night. One gets the passport — the whole crowd laughs.",
      audience: "Friends, colleagues, relatives with humour — when you want fun without pomposity.",
      story: "At a birthday sauna, the friend got «Passportus Alcoholicus» — the whole crew joined in.",
    },
    lv: {
      name: "Joka «alkoholiķa» pase (18+)",
      what: "Jokaina personīga pase ar foto, «vizām» un vakara uzdevumiem — izskatās īsta, bet ir par joku.",
      idea: "Dāvināt ne lietu, bet vakara noskaņu. Viens saņem pasi — smejas visa kompānija.",
      audience: "Draugam, kolēģim ar humoru — kad gribas ko vieglu un neaizmirstamu.",
      story: "Dzimšanas dienā pirtī draugs saņēma «Passportus Alcoholicus» — visi iesaistījās.",
    },
    et: {
      name: "Naljapass joogile (18+)",
      what: "Naljakas isiklik pass foto, «viisade» ja õhtuste ülesannetega — näeb päris välja.",
      idea: "Kinkida mitte asja, vaid õhtu meeleolu. Üks saab passi — kogu seltskond naerab.",
      audience: "Sõbrale, kolleegile huumorimeelega — kui tahad kergust ilma pompa'ta.",
      story: "Sünnipäeval saunas sai sõber «Passportus Alcoholicus» — kogu seltskond kaasas.",
    },
    lt: {
      name: "Juoko «alkoholiko» pasas (18+)",
      what: "Juokingas asmeninis pasas su foto, «vizomis» ir vakaro užduotimis — atrodo tikras, bet juokas.",
      idea: "Dovanoti ne daiktą, o vakaro nuotaiką. Vienas gauna pasą — juokiasi visa kompanija.",
      audience: "Draugui, kolegai su humoru — kai norisi lengvos, įsimintinos dovanos.",
      story: "Gimtadienyje pirtyje draugas gavo «Passportus Alcoholicus» — visi įsitraukė.",
    },
  },
  "family-subscription": {
    en: {
      name: "Family newspaper subscription",
      what: "A family newspaper that keeps coming — monthly, quarterly, or yearly. You send news and photos — we print and deliver.",
      idea: "Stay connected beyond messengers — something warm you can hold, reread, and leave on the table.",
      audience: "Families with kids, grandchildren and parents — a gift that keeps giving for months.",
      story: "Three cities, one quarterly paper for grandma — she calls to discuss every issue.",
    },
    lv: {
      name: "Ģimenes avīze abonementā",
      what: "Ģimenes avīze, kas nāk atkal un atkal — reizi mēnesī, ceturksnī vai gadā. Jūs sūtāt ziņas — mēs drukājam.",
      idea: "Turēt saikni ne tikai čatā, bet ar koņu, ko var paņemt rokās un pārlasīt.",
      audience: "Ģimenēm ar bērniem un vecvecākiem — dāvana, kas priecē mēnešiem.",
      story: "Trīs pilsētas, viena ceturkšņa avīze vecmāmiņai — viņa zvana pēc katra numura.",
    },
    et: {
      name: "Perekonna ajalehe tellimus",
      what: "Perekonna ajaleht, mis tuleb ikka ja jälle — kord kuus, kvartalis või aastas. Te saadate uudised — me trükime.",
      idea: "Hoida sidet mitte ainult sõnumites, vaid sooja formaadiga, mida saab käes hoida.",
      audience: "Peredele laste ja vanavanematega — kingitus, mis rõõmustab kuude kaupa.",
      story: "Kolm linna, üks kvartaliajakiri vanaemale — ta helistab pärast iga numbrit.",
    },
    lt: {
      name: "Šeimos laikraštis prenumerata",
      what: "Šeimos laikraštis, kuris ateina vėl ir vėl — kas mėnesį, ketvirtį ar metus. Jūs siunčiate naujienas — mes spausdiname.",
      idea: "Palaikyti ryšį ne tik žinutėse — šiltu formatu, kurį galima laikyti rankose.",
      audience: "Šeimoms su vaikais ir seneliais — dovana, kuri džiugina mėnesiais.",
      story: "Trys miestai, vienas ketvirtinis laikraštis močiutei — ji skambina po kiekvieno numerio.",
    },
  },
};

export function getLocalizedCatalogCard(
  externalId: string,
  lang: BotLanguage,
): { name: string; description: string } | null {
  if (lang === "ru") return null;
  const card = CARDS[externalId]?.[lang];
  if (!card) return null;
  return { name: card.name, description: assembleLocalizedCard(card, lang) };
}

export function localizedProductName(
  externalId: string,
  lang: BotLanguage,
  fallback: string,
): string {
  if (lang === "ru") return fallback;
  return CARDS[externalId]?.[lang]?.name ?? CARDS[externalId]?.en?.name ?? fallback;
}
