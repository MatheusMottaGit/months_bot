import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "baileys";
import qrcode from "qrcode-terminal";

const TARGET = "5524981612353@s.whatsapp.net";

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const sock = makeWASocket({ auth: state, printQRInTerminal: true });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("Connected!");
      await sock.sendMessage(TARGET, { text: "Hello from months_bot!" });
      console.log("Message sent!");
    }

    if (connection === "close") {
      const reason = (lastDisconnect?.error as any)?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        start();
      }
    }
  });
}

start();
