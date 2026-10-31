export interface KnowledgeBase {
  title: string;
  content: string;
  keywords: string[];
}

export const KNOWLEDGE_BASE_PL: KnowledgeBase[] = [
  {
    title: "Godziny otwarcia",
    content:
      "Od poniedziałku do piątku: 9:00–18:00. Sobota: 10:00–14:00. Niedziela i święta: zamknięte.",
    keywords: ["godziny", "otwarcie", "otwarte", "zamknięte", "sobota", "niedziela", "święta"],
  },
  {
    title: "Adres i parking",
    content:
      "Bluebird Bike Workshop znajduje się pod adresem 12 Maple Street, Springfield. Bezpłatny parking znajduje się za budynkiem.",
    keywords: ["adres", "lokalizacja", "dojazd", "parking", "samochód", "mapa"],
  },
  {
    title: "Kontakt",
    content: "Telefon: +1 555 0100. E-mail: hello@bluebird-bikes.example.",
    keywords: ["kontakt", "telefon", "numer", "email", "e-mail", "adres mailowy"],
  },
  {
    title: "Cennik",
    content:
      "Podstawowy przegląd roweru: 49 USD. Pełny serwis roweru: 119 USD. Naprawa przebitej dętki: 15 USD. Regulacja hamulców: 20 USD. Części zamienne są naliczane osobno.",
    keywords: [
      "cena",
      "cennik",
      "koszt",
      "ile",
      "zapłata",
      "przegląd",
      "serwis",
      "naprawa",
      "dętka",
      "kapeć",
      "hamulce",
      "regulacja",
      "części",
    ],
  },
  {
    title: "Rezerwacje wizyt",
    content: "Rezerwacji można dokonać telefonicznie lub przez e-mail.",
    keywords: [
      "rezerwacja",
      "rezerwować",
      "termin",
      "wizyta",
      "umówić",
      "zapisać",
      "telefon",
      "email",
    ],
  },
  {
    title: "Anulowanie rezerwacji",
    content: "Rezerwację można bezpłatnie anulować najpóźniej 24 godziny przed umówioną wizytą.",
    keywords: [
      "anulowanie",
      "anulować",
      "odwołanie",
      "odwołać",
      "rezygnacja",
      "zwrot",
      "bezpłatnie",
      "24 godziny",
    ],
  },
  {
    title: "Dostarczenie roweru",
    content: "Rower należy dostarczyć do warsztatu w godzinach otwarcia.",
    keywords: ["dostarczyć", "dostawa", "przywieźć", "oddać", "rower", "warsztat"],
  },
  {
    title: "Kosztorys naprawy",
    content: "Przed rozpoczęciem jakichkolwiek prac przedstawiamy pisemny kosztorys.",
    keywords: ["kosztorys", "wycena", "cena", "koszt", "przed", "zgoda", "naprawa"],
  },
  {
    title: "Czas realizacji napraw",
    content:
      "Podstawowy przegląd trwa zazwyczaj od 1 do 2 dni roboczych. Pełny serwis trwa zazwyczaj od 3 do 4 dni roboczych.",
    keywords: [
      "czas",
      "termin",
      "ile",
      "trwa",
      "gotowy",
      "odbiór",
      "dni",
      "przegląd",
      "serwis",
      "naprawa",
    ],
  },
  {
    title: "Odbiór roweru",
    content: "Kontaktujemy się telefonicznie, gdy rower jest gotowy do odbioru.",
    keywords: ["odbiór", "odebrać", "gotowy", "telefon", "powiadomienie", "kontakt"],
  },
  {
    title: "Gwarancja",
    content: "Wszystkie naprawy objęte są 30-dniową gwarancją na wykonane prace.",
    keywords: ["gwarancja", "reklamacja", "usterka", "naprawa", "30 dni", "odpowiedzialność"],
  },
  {
    title: "Płatności",
    content: "Akceptujemy gotówkę oraz karty kredytowe i debetowe.",
    keywords: [
      "płatność",
      "płatności",
      "zapłata",
      "gotówka",
      "karta",
      "kredytowa",
      "debetowa",
      "metody płatności",
    ],
  },
];

export const KNOWLEDGE_BASE: KnowledgeBase[] = [
  {
    title: "Opening Hours",
    content:
      "Monday to Friday: 9:00 AM–6:00 PM. Saturday: 10:00 AM–2:00 PM. Closed on Sundays and public holidays.",
    keywords: [
      "hours",
      "opening",
      "open",
      "closed",
      "Saturday",
      "Sunday",
      "holidays",
      "schedule",
      "working hours",
    ],
  },
  {
    title: "Address and Parking",
    content:
      "Bluebird Bike Workshop is located at 12 Maple Street, Springfield. Free parking is available behind the building.",
    keywords: ["address", "location", "directions", "parking", "car", "map", "where", "find"],
  },
  {
    title: "Contact Information",
    content: "Phone: +1 555 0100. Email: hello@bluebird-bikes.example.",
    keywords: ["contact", "phone", "telephone", "number", "email", "mail", "reach", "call"],
  },
  {
    title: "Pricing",
    content:
      "Basic bike inspection: 49 USD. Full bike service: 119 USD. Flat tire repair: 15 USD. Brake adjustment: 20 USD. Replacement parts are charged separately.",
    keywords: [
      "price",
      "pricing",
      "cost",
      "how much",
      "payment",
      "inspection",
      "service",
      "repair",
      "flat tire",
      "puncture",
      "brakes",
      "adjustment",
      "parts",
    ],
  },
  {
    title: "Appointments and Reservations",
    content: "Appointments can be booked by phone or email.",
    keywords: [
      "appointment",
      "reservation",
      "booking",
      "book",
      "schedule",
      "visit",
      "arrange",
      "phone",
      "email",
    ],
  },
  {
    title: "Appointment Cancellation",
    content:
      "Appointments can be cancelled free of charge at least 24 hours before the scheduled visit.",
    keywords: [
      "cancellation",
      "cancel",
      "reschedule",
      "withdraw",
      "refund",
      "free",
      "24 hours",
      "appointment",
    ],
  },
  {
    title: "Dropping Off Your Bike",
    content: "Bikes must be brought to the workshop during opening hours.",
    keywords: ["drop off", "deliver", "bring", "bike", "bicycle", "workshop", "delivery"],
  },
  {
    title: "Repair Estimates",
    content: "A written cost estimate is provided before any work begins.",
    keywords: ["estimate", "quote", "pricing", "cost", "repair", "approval", "written estimate"],
  },
  {
    title: "Repair Turnaround Time",
    content:
      "A basic bike inspection usually takes 1 to 2 business days. A full bike service usually takes 3 to 4 business days.",
    keywords: [
      "time",
      "duration",
      "how long",
      "turnaround",
      "ready",
      "pickup",
      "days",
      "inspection",
      "service",
      "repair",
    ],
  },
  {
    title: "Bike Collection",
    content: "We will contact you by phone when your bike is ready for collection.",
    keywords: [
      "collection",
      "pickup",
      "collect",
      "pick up",
      "ready",
      "phone",
      "notification",
      "contact",
    ],
  },
  {
    title: "Warranty",
    content: "All repairs come with a 30-day warranty covering the work performed.",
    keywords: [
      "warranty",
      "guarantee",
      "complaint",
      "fault",
      "defect",
      "repair",
      "30 days",
      "coverage",
    ],
  },
  {
    title: "Payment Methods",
    content: "We accept cash, credit cards, and debit cards.",
    keywords: [
      "payment",
      "pay",
      "cash",
      "card",
      "credit card",
      "debit card",
      "payment methods",
      "accepted",
    ],
  },
];
