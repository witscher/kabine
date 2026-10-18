// SMS adapter with a fake provider. Numbers invented.
import { describe, expect, it } from "vitest";
import { normalizePhone, sendSms, SmsError, validSender } from "../worker/provider";

describe("SMS", () => {
  it("normalisiert Telefonnummern", () => {
    expect(normalizePhone("0151 2345 6789")).toBe("+4915123456789");
    expect(normalizePhone("+49 (151) 2345-6789")).toBe("+4915123456789");
    expect(normalizePhone("0043 664 1234567")).toBe("+436641234567");
    expect(normalizePhone("12")).toBeNull();
    expect(normalizePhone("hallo")).toBeNull();
  });

  it("Absender höchstens 11 Zeichen", () => {
    expect(validSender("SVMusterst")).toBe(true);
    expect(validSender("SV Musterstadt")).toBe(false);
  });

  it("schickt über seven.io und meldet Fehler", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ success: "100" }));
    }) as unknown as typeof fetch;
    await sendSms({ provider: "seven", apiKey: "k", sender: "Kabine" }, "+4915123456789", "Dein Code: 123456", ok);
    expect(calls[0]!.url).toBe("https://gateway.seven.io/api/sms");
    expect((calls[0]!.init.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ to: "+4915123456789", text: "Dein Code: 123456", from: "Kabine" });
    const refused = (async () => new Response(JSON.stringify({ success: "900" }))) as unknown as typeof fetch;
    await expect(sendSms({ provider: "seven", apiKey: "k", sender: "Kabine" }, "+4915123456789", "x", refused)).rejects.toBeInstanceOf(SmsError);
    const down = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(sendSms({ provider: "seven", apiKey: "k", sender: "Kabine" }, "+4915123456789", "x", down)).rejects.toThrow("500");
  });
});
