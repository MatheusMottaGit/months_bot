import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "baileys";
import qrcode from "qrcode-terminal";
import Imap from "imap";
import { simpleParser } from "mailparser";

const TARGET = process.env.APP_TARGET || "";
const SENDER = process.env.APP_SENDER || "";
const MESSAGE = "20232028913102003";

const imap = new Imap({
  user: process.env.APP_USER || "",
  password: process.env.APP_PASSWORD || "",
  host: process.env.APP_HOST || "",
  port: process.env.APP_PORT ? parseInt(process.env.APP_PORT) : 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
});

function openInbox(cb: (err: Error | null, box?: Imap.Box) => void) {
  imap.openBox("INBOX", true, cb);
}

function getCurrentMonthSearch(): string {
  const now = new Date();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[now.getMonth()]} ${now.getFullYear()}`;
}

imap.once("ready", () => {
  openInbox((err) => {
    if (err) throw err;

    const searchCriteria = [
      ["FROM", SENDER],
      ["SINCE", `01-${getCurrentMonthSearch()}`],
    ];

    imap.search(searchCriteria, (err, results) => {
      if (err) throw err;

      if (!results.length) {
        console.log("No emails found from", SENDER, "this month.");
        imap.end();
        return;
      }

      console.log(`Found ${results.length} email(s) from ${SENDER}`);

      // Get only the most recent email
      const latestResult = [results[results.length - 1]!];
      const fetch = imap.fetch(latestResult, { bodies: "" });
      let sent = false;

      fetch.on("message", (msg) => {
        msg.on("body", async (stream) => {
          if (sent) return;

          const parsed = await simpleParser(stream);
          const pdfAttachment = parsed.attachments?.find(
            (att) => att.contentType === "application/pdf"
          );

          if (pdfAttachment && !sent) {
            sent = true;
            console.log("Found PDF:", pdfAttachment.filename);
            await sendWhatsApp(pdfAttachment.content);
          }
        });
      });

      fetch.once("end", () => {
        console.log("Done processing emails.");
        imap.end();
      });
    });
  });
});

imap.once("error", (err: Error) => console.error(err));
imap.once("end", () => console.log("Connection ended."));

async function sendWhatsApp(pdfBuffer: Buffer) {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const sock = makeWASocket({ auth: state, printQRInTerminal: true });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("Connected to WhatsApp!");

      // Send text message first
      await sock.sendMessage(TARGET, { text: MESSAGE });
      console.log("Text message sent!");

      // Send PDF file
      await sock.sendMessage(TARGET, {
        document: pdfBuffer,
        mimetype: "application/pdf",
        fileName: "boleto.pdf",
      });
      console.log("PDF sent!");

      // Exit process after sending
      process.exit(0);
    }
  });
}

imap.connect();
