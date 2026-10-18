// Admin-Export mit Datenschutzhinweis vor dem Herunterladen (Verwaltung, Saisonwechsel).
import { confirmDialog } from "./ui";

export const EXPORT_URL = "/api/admin/export";

/** Zeigt den Hinweis zum Umgang mit den Daten und lädt erst nach Bestätigung herunter. */
export async function downloadExport(): Promise<boolean> {
  const ok = await confirmDialog({
    title: "Hinweis",
    message: (
      // Text vom Verein (10.10.2026)
      <p style={{ textAlign: "left" }}>
        Die Datei enthält persönliche Daten von Personen, auch von Minderjährigen. Sie dient nur der Datensicherung des Vereins und darf nicht weitergegeben werden.
        Lösche sie nach spätestens 30 Tagen von deinem Rechner. Die Sicherung des Vereins gehört verschlüsselt in den dafür vorgesehenen Speicher. Ist ein Speicherort,
        zum Beispiel dein Rechner, durch einen Virus oder Ähnliches für Unbefugte zugänglich geworden, informiere unverzüglich die Vorstandschaft.
      </p>
    ),
    confirmLabel: "Verstanden, herunterladen",
  });
  if (!ok) return false;
  const a = document.createElement("a");
  a.href = EXPORT_URL;
  // Nicht leer: Der Router fängt Links ohne download-Wert ab. Den Dateinamen mit Datum setzt der Server.
  a.download = "kabine-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}
