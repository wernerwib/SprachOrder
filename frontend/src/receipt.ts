import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import qrcode from "qrcode-generator";
import { Platform } from "react-native";

import { Bill, euro, Settings } from "@/src/api";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** QR code as a GIF data URL – works in the receipt HTML and in <Image>. */
export function qrDataUrl(text: string, cellSize = 4) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize, 2);
}

export function receiptHtml(bill: Bill, settings?: Settings) {
  const name = settings?.restaurant_name || "Pizzaiolo";
  const address = settings?.address ? `<div class="meta">${esc(settings.address)}</div>` : "";
  const review = settings?.review_url
    ? `<hr /><div class="c review">
        <div class="rt">Hat es Ihnen geschmeckt?</div>
        <div class="rs">Wir freuen uns über Ihre Bewertung auf Google</div>
        <img src="${qrDataUrl(settings.review_url)}" width="132" height="132" alt="QR-Code Google-Bewertung" />
        <div class="rs">QR-Code mit der Handykamera scannen</div>
      </div>`
    : "";
  const now = new Date();
  const date = now.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const rows = bill.lines
    .map(
      (l) => `<tr>
        <td class="q">${l.qty}×</td>
        <td>${esc(l.name)}<div class="u">je ${euro(l.price)}</div></td>
        <td class="r">${euro(l.amount)}</td>
      </tr>`,
    )
    .join("");
  const paid =
    bill.paid_total > 0
      ? `<tr><td colspan="2">Bereits bezahlt</td><td class="r">− ${euro(bill.paid_total)}</td></tr>
         <tr class="open"><td colspan="2">Offen</td><td class="r">${euro(bill.open_total)}</td></tr>`
      : "";
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  @page { margin: 12mm; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #2D1A11; max-width: 340px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0; letter-spacing: 1px; }
  .c { text-align: center; }
  .meta { color: #8D786E; font-size: 13px; margin-top: 4px; }
  hr { border: none; border-top: 1.5px dashed #C2B2A3; margin: 14px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  td { padding: 5px 0; vertical-align: top; }
  .q { width: 36px; font-weight: 700; color: #D84339; }
  .u { color: #8D786E; font-size: 12px; }
  .r { text-align: right; white-space: nowrap; }
  .total td { font-size: 20px; font-weight: 800; padding-top: 10px; }
  .open td { font-weight: 800; color: #D84339; }
  .foot { color: #8D786E; font-size: 11px; margin-top: 18px; text-align: center; line-height: 1.5; }
  .review img { display: block; margin: 10px auto; image-rendering: pixelated; }
  .rt { font-size: 16px; font-weight: 800; }
  .rs { color: #8D786E; font-size: 12px; margin-top: 2px; }
</style></head><body>
  <div class="c"><h1>${esc(name)}</h1>
  ${address}
  <div class="meta">Tisch ${bill.table} · ${date} · ${time} Uhr</div></div>
  <hr />
  <table>${rows}</table>
  <hr />
  <table>
    <tr class="total"><td colspan="2">Gesamt</td><td class="r">${euro(bill.total)}</td></tr>
    ${paid}
  </table>
  ${review}
  <div class="foot">Alle Preise inkl. MwSt.<br/>Vielen Dank für Ihren Besuch – grazie e arrivederci!<br/>
  Rechnungsübersicht, kein Kassenbeleg im Sinne der KassenSichV.</div>
</body></html>`;
}

/** Native: creates a PDF and opens the share sheet. Web: prints only the receipt (save as PDF in the dialog). */
export async function shareReceipt(bill: Bill, settings?: Settings) {
  const html = receiptHtml(bill, settings);
  if (Platform.OS === "web") {
    printHtmlWeb(html);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, width: 420, height: 595 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: `Bon Tisch ${bill.table}`,
    });
  } else {
    await Print.printAsync({ uri });
  }
}

export async function printReceipt(bill: Bill, settings?: Settings) {
  const html = receiptHtml(bill, settings);
  if (Platform.OS === "web") {
    printHtmlWeb(html);
    return;
  }
  await Print.printAsync({ html });
}

// expo-print on web prints the current page, so render the receipt in a hidden iframe instead.
function printHtmlWeb(html: string) {
  const doc = (globalThis as any).document;
  const frame = doc.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  doc.body.appendChild(frame);
  const w = frame.contentWindow;
  w.document.open();
  w.document.write(html);
  w.document.close();
  const go = () => {
    w.focus();
    w.print();
    setTimeout(() => frame.remove(), 1000);
  };
  if (w.document.readyState === "complete") setTimeout(go, 50);
  else frame.onload = go;
}
