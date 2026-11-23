export type Locale = "en" | "pl";

const en = {
  greeting: "Hello! How can I help?",
  headerTitle: "Assistant",
  dialogLabel: "Chat with the assistant",
  closeChat: "Close chat",
  openChat: "Open chat",
  newChat: "New chat",
  closeTip: "Close tip",
  messageLabel: "Message",
  placeholder: "Type a message…",
  send: "Send",
  stop: "Stop generation",
  typing: "Assistant is typing",
  statusIdle: "The model downloads when you open the chat ({size})",
  statusPreparing: "Preparing model: {percent}%",
  statusInitializing: "Preparing the model…",
  statusReady: "Ready to chat",
  statusError: "Model failed to load",
  statusCancelled: "Model initialization was cancelled",
  statusUnknown: "Model status unavailable",
  barError: "The model could not be loaded. Check that your browser supports WebGPU, then retry.",
  barCancelled: "Model loading was interrupted.",
  retry: "Retry",
  noticeModelError: "The model could not be loaded. Retry loading before sending your message.",
  noticeModelPreparing: "The model is still preparing. Your message has not been sent.",
  errorMessageTooLong: "Your message is too long. Please shorten it and try again.",
  errorConversationTooLong: "This conversation is too long. Start a new chat to continue.",
  errorGeneric: "An error occurred while generating the response.",
  errorEmptyResponse: "Failed to generate a response.",
  disclaimer: "The AI assistant runs locally in your browser. Responses may be inaccurate.",
  teaser: "Hello! Have a question? I'm happy to help.",
} as const;

export type MessageKey = keyof typeof en;

const pl: Record<MessageKey, string> = {
  greeting: "Cześć! W czym mogę pomóc?",
  headerTitle: "Asystent",
  dialogLabel: "Czat z asystentem",
  closeChat: "Zamknij czat",
  openChat: "Otwórz czat",
  newChat: "Nowy czat",
  closeTip: "Zamknij podpowiedź",
  messageLabel: "Wiadomość",
  placeholder: "Napisz wiadomość…",
  send: "Wyślij",
  stop: "Zatrzymaj generowanie",
  typing: "Asystent pisze",
  statusIdle: "Model zostanie pobrany po otwarciu czatu ({size})",
  statusPreparing: "Przygotowywanie modelu: {percent}%",
  statusInitializing: "Przygotowywanie modelu…",
  statusReady: "Gotowy do rozmowy",
  statusError: "Nie udało się wczytać modelu",
  statusCancelled: "Inicjalizacja modelu została anulowana",
  statusUnknown: "Stan modelu jest niedostępny",
  barError:
    "Nie udało się wczytać modelu. Sprawdź, czy Twoja przeglądarka obsługuje WebGPU, i spróbuj ponownie.",
  barCancelled: "Wczytywanie modelu zostało przerwane.",
  retry: "Spróbuj ponownie",
  noticeModelError: "Nie udało się wczytać modelu. Ponów wczytywanie, zanim wyślesz wiadomość.",
  noticeModelPreparing: "Model wciąż się przygotowuje. Twoja wiadomość nie została wysłana.",
  errorMessageTooLong: "Wiadomość jest zbyt długa. Skróć ją i spróbuj ponownie.",
  errorConversationTooLong: "Ta rozmowa jest zbyt długa. Rozpocznij nowy czat, aby kontynuować.",
  errorGeneric: "Wystąpił błąd podczas generowania odpowiedzi.",
  errorEmptyResponse: "Nie udało się wygenerować odpowiedzi.",
  disclaimer:
    "Asystent AI działa lokalnie w Twojej przeglądarce. Odpowiedzi mogą być nieprawidłowe.",
  teaser: "Cześć! Masz pytanie? Chętnie pomogę.",
};

export const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, pl };

export interface LocaleSources {
  elementLang?: string;
  htmlLang?: string;
  navigatorLanguage?: string;
}

export const resolveLocale = (opts: LocaleSources): Locale => {
  const source = [opts.elementLang, opts.htmlLang, opts.navigatorLanguage].find(
    (value) => value !== undefined && value.trim() !== ""
  );
  return source !== undefined && source.trim().toLowerCase().startsWith("pl") ? "pl" : "en";
};

export const createTranslator =
  (locale: Locale) =>
  (key: MessageKey, params?: Record<string, string | number>): string => {
    const template = dictionaries[locale][key];
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match
    );
  };
