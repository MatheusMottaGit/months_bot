import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "baileys";
import qrcode from "qrcode-terminal";
import Imap from "imap";
import { simpleParser } from "mailparser";
import "dotenv/config";

const TARGET = process.env.WHATSAPP_TARGET || "";
const SENDER = process.env.IMAP_SENDER || "";
const MESSAGE = process.env.WHATSAPP_MESSAGE || "";

const imap = new Imap({
  user: process.env.IMAP_USER || "",
  password: process.env.IMAP_PASSWORD || "",
  host: process.env.IMAP_HOST || "",
  port: process.env.IMAP_PORT ? parseInt(process.env.IMAP_PORT) : 993,
  tls: process.env.IMAP_TLS === "true",
  tlsOptions: { rejectUnauthorized: false },
});

function openInbox(cb: (err: Error | null, box?: Imap.Box) => void) {
  imap.openBox("INBOX", true, cb);
}

function getCurrentMonthSearch(): { since: string; to: string } {
  const now = new Date();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const currentMonth = months[now.getMonth()];
  return {
    since: `01-${now.getFullYear()}-${currentMonth}`,
    to: `25-${now.getFullYear()}-${currentMonth}`,
  };
}

async function sendWhatsApp(pdfBuffer: Buffer) {
  console.log("Initializing WhatsApp connection...");
  
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const sock = makeWASocket({ 
    auth: state,
  });

  sock.ev.on("creds.update", saveCreds);

  return new Promise<void>((resolve, reject) => {
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("\nScan this QR code with WhatsApp:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "close") {
        const shouldReconnect =
          (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
        
        console.log("Connection closed. Should reconnect?", shouldReconnect);
        
        if (shouldReconnect) {
          reject(new Error("Connection failed"));
        } else {
          resolve();
        }
      }

      if (connection === "open") {
        try {
          console.log("Connected to WhatsApp!");
          
          await sock.sendMessage(TARGET, { text: MESSAGE });
          console.log("Text message sent!");

          await sock.sendMessage(TARGET, {
            document: pdfBuffer,
            mimetype: "application/pdf",
            fileName: "boleto.pdf",
          });
          console.log("PDF sent successfully!");

          setTimeout(() => {
            sock.end(undefined);
            resolve();
          }, 2000);
        } catch (error) {
          console.error("Error sending messages:", error);
          reject(error);
        }
      }
    });
  });
}

imap.once("ready", () => {
  console.log("IMAP connection ready");
  
  openInbox((err) => {
    if (err) {
      console.error("Error opening inbox:", err);
      imap.end();
      return;
    }

    const searchCriteria = [
      ["FROM", SENDER],
      ["SINCE", getCurrentMonthSearch().since],
      ["BEFORE", getCurrentMonthSearch().to]
    ];

    imap.search(searchCriteria, (err, results) => {
      if (err) {
        console.error("Search error:", err);
        imap.end();
        return;
      }

      if (!results.length) {
        console.log("No emails found from", SENDER, "this month.");
        imap.end();
        process.exit(0);
        return;
      }

      console.log(`Found ${results.length} email(s) from ${SENDER}`);

      const latestResult = [results[results.length - 1]!];
      const fetch = imap.fetch(latestResult, { bodies: "" });
      let sent = false;
      let pdfFound = false;

      fetch.on("message", (msg) => {
        msg.on("body", async (stream) => {
          if (pdfFound) return;
          
          try {
            const parsed = await simpleParser(stream);
            const pdfAttachment = parsed.attachments?.find(
              (att) => att.contentType === "application/pdf"
            );

            if (pdfAttachment && !pdfFound) {
              pdfFound = true;
              console.log("Found PDF:", pdfAttachment.filename);
              
              // Close IMAP connection first
              imap.end();
              
              // Wait a bit for IMAP to close properly
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Then send via WhatsApp
              if (!sent) {
                sent = true;
                try {
                  await sendWhatsApp(pdfAttachment.content);
                  console.log("\n✅ Process completed successfully!");
                  process.exit(0);
                } catch (error) {
                  console.error("\n❌ Error sending WhatsApp:", error);
                  process.exit(1);
                }
              }
            }
          } catch (error) {
            console.error("Error parsing email:", error);
          }
        });
      });

      fetch.once("error", (err) => {
        console.error("Fetch error:", err);
        imap.end();
        process.exit(1);
      });

      fetch.once("end", () => {
        console.log("Done fetching emails.");
        if (!pdfFound) {
          console.log("No PDF attachment found in the email.");
          imap.end();
          process.exit(0);
        }
      });
    });
  });
});

imap.once("error", (err: Error) => {
  console.error("IMAP error:", err);
  process.exit(1);
});

imap.once("end", () => {
  console.log("IMAP connection ended.");
});

console.log("Connecting to IMAP server...");
imap.connect();