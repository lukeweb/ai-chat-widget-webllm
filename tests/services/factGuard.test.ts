import { describe, expect, it } from "@jest/globals";
import { findUnsupportedNumbers } from "../../src/services/factGuard";

const HOURS = "Od poniedziałku do piątku: 9:00–18:00. Sobota: 10:00–14:00.";
const PRICES = "Podstawowy przegląd roweru: 49 USD. Pełny serwis roweru: 119 USD.";

describe("findUnsupportedNumbers", () => {
  it("accepts an answer whose numbers all come from the knowledge base", () => {
    expect(findUnsupportedNumbers("W sobotę jesteśmy otwarci 10:00–14:00.", HOURS, "A w sobotę?")).toEqual(
      []
    );
  });

  it("reports numbers that are not in the knowledge base", () => {
    expect(findUnsupportedNumbers("Przegląd kosztuje 59 USD.", PRICES, "Ile kosztuje przegląd?")).toEqual([
      "59",
    ]);
    expect(findUnsupportedNumbers("Otwieramy o 8:00.", HOURS, "Kiedy otwieracie?")).toEqual(["8"]);
  });

  it.each([
    ["9:00 written as 9", "Otwieramy o 9."],
    ["9:00 written as 9.00", "Otwieramy o 9.00."],
    ["9:00 written with a leading zero", "Otwieramy o 09:00."],
    ["a price with decimals", "Przegląd kosztuje 49,00 USD."],
  ])("treats %s as the same number", (_label, answer) => {
    expect(findUnsupportedNumbers(answer, `${HOURS} ${PRICES}`, "Pytanie")).toEqual([]);
  });

  it("treats 9.30 and 9:30 as the same time but not as 9", () => {
    expect(findUnsupportedNumbers("Od 9.30.", "Otwarte od 9:30.", "?")).toEqual([]);
    expect(findUnsupportedNumbers("Od 9.30.", "Otwarte od 9:00.", "?")).toEqual(["9:30"]);
  });

  it("joins thousands written with a space, including a non-breaking space", () => {
    expect(findUnsupportedNumbers("Cena: 1200 zł.", "Cena: 1 200 zł.", "?")).toEqual([]);
    expect(findUnsupportedNumbers("Cena: 1\u00a0200 zł.", "Cena: 1200 zł.", "?")).toEqual([]);
  });

  it("accepts comma or dot thousands separators against a plain number, and back", () => {
    expect(findUnsupportedNumbers("Cena: 1,200 zł.", "Cena: 1200 zł.", "?")).toEqual([]);
    expect(findUnsupportedNumbers("Cena: 1.200 zł.", "Cena: 1200 zł.", "?")).toEqual([]);
    expect(findUnsupportedNumbers("Price: 1200 USD.", "Price: 1,200 USD.", "?")).toEqual([]);
    expect(findUnsupportedNumbers("Price: 1,250,000 USD.", "Price: 1250000 USD.", "?")).toEqual([]);
  });

  it("still rejects a different grouped number and keeps short decimals as decimals", () => {
    expect(findUnsupportedNumbers("Cena: 1,300 zł.", "Cena: 1200 zł.", "?")).toEqual(["1:300"]);
    expect(findUnsupportedNumbers("Cena: 12,5 zł.", "Cena: 125 zł.", "?")).toEqual(["12:5"]);
  });

  it("allows numbers the user wrote in the question", () => {
    expect(findUnsupportedNumbers("Tak, w sobotę 15.08 jest otwarte.", HOURS, "Czy 15.08 jest otwarte?")).toEqual(
      []
    );
  });

  it("accepts answers without numbers and reports each unsupported number once", () => {
    expect(findUnsupportedNumbers("Zapraszamy!", "", "Cześć")).toEqual([]);
    expect(findUnsupportedNumbers("Za 5 USD, tylko 5 USD.", "", "?")).toEqual(["5"]);
  });

  it("does not check numbers written as words", () => {
    expect(findUnsupportedNumbers("Otwieramy o dziewiątej.", "", "?")).toEqual([]);
  });
});
